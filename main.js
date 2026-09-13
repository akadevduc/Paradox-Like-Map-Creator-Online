import * as utils from "./utils.js";
import { timerStart, timerEnd }                             from "./utils.js";
import { initCamera }                                       from "./camera.js";
import { buildProvinceData, createBaseMap,
         addBorders, renderFromBase }            from "./provinces.js";
import { initCountriesFromProvinceData }                    from "./countries.js";
import { initUI, ToolStates }                              from "./ui.js";
import { state, provinceData,
         colorToProvince,
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
export const logicCtx     = logicCanvas.getContext("2d", { willReadFrequently: true });

export const canvasRender = document.createElement("canvas");
export const ctxRender    = canvasRender.getContext("2d", { willReadFrequently: true });

export const waterCanvas  = document.createElement("canvas");
export const waterCtx     = waterCanvas.getContext("2d", { willReadFrequently: true });

// =======================
// IMAGEN BASE
// =======================
export const img = new Image();
img.src = state.imgSrc;

let uiInitialized = false;

img.onload = async () => {
    bufferToScreen(canvas);

    logicCanvas.width  = img.width;
    logicCanvas.height = img.height;

    // Fijar dimensiones de canvasRender para que buildCanvasRender funcione
    canvasRender.width  = img.width;
    canvasRender.height = img.height;

    if (!uiInitialized) {
        initCamera(canvas, utils);
        initUI(img, canvas, logicCanvas, setup);
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
    timerStart("setup");

    // Inicializar provincePixelIndices (Uint16Array plano: posición = índice de píxel, valor = ID de provincia)
    const mapW = logicCanvas.width;
    const mapH = logicCanvas.height;
    state.provincePixelIndices = new Uint16Array(mapW * mapH);

    // Step 1: Dibujar mapa inmediatamente — el usuario ve el fondo al instante
    logicCtx.drawImage(img, 0, 0);

    // Step 2: Cargar provincias y datos básicos primero (síncronos)
    // Esto asegura que colorToProvince y provinceData estén disponibles
    // antes de renderizar, evitando provincias transparentes.
    state.loaded = await loadMapProvinces(jsonSrc);
    buildProvinceData();

    // Marcar que ya venimos de un loadMapProvinces para no repetirlo en background
    state.provincesPreloaded = true;

    // Step 2.5: buildProvinceData ahora llena provincePixelIndices directamente
    // en buildProvinceData (se inicializó arriba como Uint16Array).

    // Step 3: Crear imágenes base con los provinces ya poblados
    state.baseCleanImageData = createBaseMap();
    state.baseCleanImageData = new ImageData(
        new Uint8ClampedArray(state.baseCleanImageData.data),
        state.baseCleanImageData.width,
        state.baseCleanImageData.height
    );
    renderFromBase();

    // Step 4: Cargar datos de provincias EN BACKGROUND (sin provincias de agua)
    // Los ríos/lagos se generarán desde una función externa usando una imagen base
    setTimeout(async () => {
        try {
            timerStart("lazy-provinces");
            addBorders();
            initCountriesFromProvinceData();
            timerEnd("lazy-provinces");

            // Marcar dirty para reconstruir canvasRender con los datos completos
            state.canvasDirty = true;
            renderFromBase();
            console.log("Datos de provincias cargados en background");
        } catch (err) {
            console.error("Error loading province data in background:", err);
        }
    }, 100); // Pequeño delay para que el primer render sea visible

    timerEnd("setup");
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
    // provincePixelIndices es un Uint16Array, no un Map; reinicializar a null
    state.provincePixelIndices = null;
    state.selectedProvince    = null;
    state.highlightImageData  = null;
}

export function bufferToScreen(canvas)
{
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
}
