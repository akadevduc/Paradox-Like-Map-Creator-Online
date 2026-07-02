import * as utils from "./utils.js";
import { initCamera }                                       from "./camera.js";
import { buildProvinceData, createBaseMap,
         addBorders, renderFromBase,
         rebuildOverlayCanvas, loadWaterLayers }            from "./provinces.js";
import { initCountriesFromProvinceData }                    from "./countries.js";
import { initUI, ToolStates }                              from "./ui.js";
import { state, overlayLayers, provinceData,
         colorToProvince, provincePixels,
         nextProvinceId, bumpProvinceId }                   from "./state.js";
import { initEditor }                                       from "./tijerear.js";
import { initMapEditor, toggleMapEditor,
         floodFill, confirmEdit, cancelEdit}                from "./editor.js";

// =======================
// CANVAS & CONTEXTOS
// =======================
export const canvas       = document.getElementById("mapCanvas");
export const ctx          = canvas.getContext("2d");

export const logicCanvas  = document.createElement("canvas");
export const logicCtx     = logicCanvas.getContext("2d");

export const canvasRender = document.createElement("canvas");
export const ctxRender    = canvasRender.getContext("2d");

export const waterCanvas  = document.createElement("canvas");
export const waterCtx     = waterCanvas.getContext("2d");

export const overlayCanvas = document.createElement("canvas");
export const overlayCtx    = overlayCanvas.getContext("2d");

// =======================
// IMAGEN BASE
// =======================
export const img = new Image();
img.src = state.imgSrc;

let uiInitialized = false;

img.onload = async () => {
    canvas.width  = img.width;
    canvas.height = img.height;

    logicCanvas.width  = img.width;
    logicCanvas.height = img.height;

    overlayCanvas.width  = img.width;
    overlayCanvas.height = img.height;

    for (const layer of overlayLayers) {
        const response = await fetch(layer.src);
        const blob = await response.blob();
        layer.img = await createImageBitmap(blob);
        console.log(layer.name, layer.img.width, layer.img.height); // ← verificar
    }

    if (!uiInitialized) {
        initCamera(canvas, utils);
        initUI(img, canvas, logicCanvas, overlayCanvas, setup);
        initEditor();
        initMapEditor();
        uiInitialized = true;
    }

    await setup(state.jsonSrc, state.legacy);
};

// =======================
// SETUP
// =======================
export async function setup(jsonSrc, legacy = false) {

    // 1. Capas de relieve
    await Promise.all(overlayLayers.map(layer => new Promise(resolve => {
        const image = new Image();
        image.onload  = () => { layer.img = image; resolve(); };
        image.onerror = () => { console.warn("No se pudo cargar:", layer.src); resolve(); };
        image.src = layer.src;
    })));
    rebuildOverlayCanvas();

    // 2. Dibujar mapa logico
    logicCtx.drawImage(img, 0, 0);

    // 3. Provincias
    state.loaded = await loadMapProvinces(jsonSrc);
    buildProvinceData();

    // 4. Capas de agua
    await loadWaterLayers();


    // 5. Render inicial
    state.baseCleanImageData = createBaseMap();
    state.baseImageData = new ImageData(
        new Uint8ClampedArray(state.baseCleanImageData.data),
        state.baseCleanImageData.width,
        state.baseCleanImageData.height
    );

    // 6. Lista de paises
    initCountriesFromProvinceData();
}

// =======================
// CARGA DE PROVINCIAS DESDE JSON
// =======================
export async function loadMapProvinces(file = "provinces.json") {
    try {
        const response = await fetch(file);
        if (!response.ok) {
            console.log("No encontrado, iniciando vacio");
            return false;
        }
        const data = await response.json();

        Object.keys(data.provinces).forEach(id => {
            const pd = data.provinces[id];
            provinceData[id] = {
                id:         parseInt(id),
                name:       pd.name,
                owner:      pd.owner,
                paintColor: pd.paintColor,
                colorKey:   pd.colorKey,
                isWater:    pd.isWater ?? false,
            };
            colorToProvince[pd.colorKey] = parseInt(id);
            while (nextProvinceId <= parseInt(id)) bumpProvinceId();
        });

        console.log("Mapa cargado desde", file);
        return true;
    } catch (err) {
        console.error("Error cargando:", err);
        return false;
    }
}

// =======================
// RESET (para cambio de modo legacy)
// =======================
export function resetMapState() {
    Object.keys(colorToProvince).forEach(k => delete colorToProvince[k]);
    Object.keys(provinceData).forEach(k    => delete provinceData[k]);
    Object.keys(provincePixels).forEach(k  => delete provincePixels[k]);
    state.selectedProvince    = null;
    state.highlightImageData  = null;
}
