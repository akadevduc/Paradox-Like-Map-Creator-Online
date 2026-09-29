import { state, waterLayers, provinceData,
         colorToProvince, waterColor,
         brushColor, colorInicial, opacityStep,
         provinceMapOpacity, setProvinceMapOpacity,
         setWaterColor, waterColorListeners }      from "./state.js";
import { createBaseMap, addBorders,
         renderFromBase,
         rebuildWaterLayer, setProvinceOpacity }         from "./provinces.js";
import { registerCountry, selectCountryColor,
         renderCountryList, countries, rgbToHex,
         isCountryLocked }                             from "./countries.js";
import { loadMapProvinces, resetMapState,
         waterCtx, waterCanvas, setup, canvas,
         logicCanvas }           from "./main.js";
import { toggleScissorMode, initEditor, setPathCompleteCallback, processCutPath, paintAlongPath }                  from "./tijerear.js";
import { initMapEditor, toggleMapEditor,
         floodFill, confirmEdit, cancelEdit}             from "./editor.js";
import { bufferToScreen } from "./main.js";
import * as utils from "./utils.js";
import { updateCameraViewport } from "./camera.js";
import { initReferences } from "./references.js";
initReferences(renderFromBase);

// Referencias a elementos UI
const saveButton       = document.getElementById("saveButton");
const clearButton      = document.getElementById("clearButton");
const colorPicker      = document.getElementById("brushColor");
const waterColorPicker = document.getElementById("waterColor");
const loadButton       = document.getElementById("loadButton");
const saveIMGButton    = document.getElementById("saveIMGButton");
const ChangeToGFMBtn   = document.getElementById("ChangeToGFMButton");

const SelectButton     = document.getElementById("SelectButton");
const PaintButton      = document.getElementById("PaintButton");
const EraserButton     = document.getElementById("EraserButton");
const InkweelButton    = document.getElementById("InkWellButton");
const LassoButton      = document.getElementById("LassoButton");
const BucketButton     = document.getElementById("BucketButton");
const CutButton        = document.getElementById("CutButton");
const EditorModeButton = document.getElementById("EditorModeButton");

const bucketModeCountry = document.getElementById("FillCountry");
const bucketModeContinuity = document.getElementById("FillContinuity");

export const ToolStates = {
    select: { active: true }, //inicial
    paint: { active: false },
    eraser: { active: false },
    inkweel: { active: false },
    lasso: { active: false },
    bucket: { active: false },
    scissor: { active: false },
    editor: { active: false }
};

export const bucketMode = {
    FillCountry: { active: true },
    FillContinuity: { active: false }
}

// Sincronizar todos los inputs de color de agua con el valor centralizado
function syncWaterColorInputs() {
    const hex = rgbToHex(waterColor.rgb);
    document.querySelectorAll('.water-color-input').forEach(el => { el.value = hex; });
}
waterColorListeners.push(syncWaterColorInputs);

function toggleToolState(activeState, buttonElement = null) {
    const isActive = !activeState.active;

    document.querySelectorAll('.sidebar a').forEach(a => a.classList.remove('active'));
    Object.values(ToolStates).forEach(ts => { ts.active = false; });

    activeState.active = isActive;
    canvas.style.cursor = "default";
    state.pinnedProvince = null;

    if (isActive && buttonElement) {
        buttonElement.classList.add('active');
    } else if (buttonElement) {
        buttonElement.classList.remove('active');
    }
    renderFromBase();
    console.log("toggleToolState:", ToolStates);
}

function toggleToolStateInside(activeState, buttonElement = null) {
    const isActive = !activeState.active;
    document.querySelectorAll('.sidebar a').forEach(a => a.classList.remove('active'));

    Object.values(ToolStates).forEach(ts => {
        if (ts !== ToolStates.editor) ts.active = false; // preservar editor.active
    });

    activeState.active = isActive;
    state.pinnedProvince = null;

    if (isActive && buttonElement) {
        buttonElement.classList.add('active');
    } else if (buttonElement) {
        buttonElement.classList.remove('active');
    }
    renderFromBase();
}

// initUI se llama desde main.js una vez que img está cargada
// Recibe referencias que de otro modo crearían dependencia circular
export function initUI(img, canvas, logicCanvas, setupFn) {

    // ── Opacidad ──
    const slider = document.getElementById('opacitySlider');
    const label  = document.getElementById('opacityLabel');
    if (slider) {
        slider.step  = opacityStep;
        slider.value = Math.round(provinceMapOpacity * 100);
        label.textContent = slider.value + '%';
        slider.addEventListener('input', e => {
            const pct = parseInt(e.target.value);
            label.textContent = pct + '%';
            setProvinceOpacity(pct / 100);
            state.baseCleanImageData = createBaseMap();
            addBorders();
            renderFromBase();
        });
    }

    // ── Color del pincel ──
    colorPicker.addEventListener("input", e => {
        const hex = e.target.value;
        brushColor.rgb = [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
        ];
        const swatch = document.getElementById("brushColorDisplay");
        if (swatch) swatch.style.backgroundColor = hex;
    });

    // ── Botón agregar país ──
    const addBtn = document.getElementById('addCountryBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const hex = colorPicker.value;
            registerCountry(hex);
            selectCountryColor(hex);
            renderCountryList();
        });
    }

    // Inicializar swatch del botón pincel
    const swatch = document.getElementById('brushColorDisplay');
    if (swatch) swatch.style.backgroundColor = '#ff0000';

    // ── Color del agua (centralizado) ──
    waterColorPicker.addEventListener("input", e => {
        const hex = e.target.value;
        setWaterColor([
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
        ]);
        rebuildWaterLayer();
        state.baseCleanImageData = createBaseMap();
        state.baseCleanImageData = new ImageData(
            new Uint8ClampedArray(state.baseCleanImageData.data),
            state.baseCleanImageData.width,
            state.baseCleanImageData.height
        );
        renderFromBase();
    });

    // ── Save / Clear ──
    saveButton.addEventListener("click", () => saveMapProvinces(logicCanvas, img));
    clearButton.addEventListener("click", () => clearMapProvinces());

    // ── Save IMG ──
    saveIMGButton.addEventListener("click", () => exportFullMap());

    // ── Load JSON ──
    loadButton.addEventListener("click", () => {
        const fileInput = document.getElementById("loadCustomMap");
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                applyProvinceData(data);
                state.baseCleanImageData = createBaseMap();
                addBorders();
                renderFromBase();
            } catch (err) {
                console.error("JSON inválido:", err);
            }
        };
        reader.readAsText(file);
    });

    document.querySelector("#loadCustomMap").onchange = function() {
        const fileName = this.files[0]?.name;
        document.querySelector("label[for=loadCustomMap]").innerText = fileName ?? "Browse Files";
    };
    
    // ── Cambio de modo legacy ──
    ChangeToGFMBtn.addEventListener("click", async () => {
        state.legacy = !state.legacy;
        state.highlightImageData = null;

        console.log(state.legacy ? "Modo LEGACY" : "Modo NORMAL");

        state.imgSrc  = state.legacy ? "maps/provinces_legacy.bmp" : "maps/map_empty.png";
        state.jsonSrc = state.legacy ? "provinces_legacy.json" : "provinces.json";

        img.src = state.imgSrc;
        await img.decode();

        resetMapState();

        logicCanvas.getContext("2d").clearRect(0, 0, logicCanvas.width, logicCanvas.height);

        if (state.legacy) {
            waterLayers.forEach(l => { l.img = null; l.visible = false; });
            waterCtx.clearRect(0, 0, waterCanvas.width, waterCanvas.height);
        } else {
            waterLayers.forEach(l => { l.visible = true; });
        }

        await setupFn(state.jsonSrc);
        console.log("canvas size después de setup:", canvas.width, canvas.height);
        //initEditor();
        //initMapEditor();
    });



    // ── Botón de seleccionar ──
    SelectButton.classList.add('active');
    SelectButton.addEventListener("click", () => {
        toggleToolState(ToolStates.select, SelectButton);
    });

    // ── Botón de Pintura ──
    PaintButton.addEventListener("click", () => {
        if(ToolStates.editor.active)
        {
            toggleToolStateInside(ToolStates.paint, PaintButton);
        }
        else
        {
            toggleToolState(ToolStates.paint, PaintButton); //se maneja el resto en camera.js
            setPathCompleteCallback((path) => paintAlongPath(path));
        }
    });

    // ── Botón de Balde ──
    BucketButton.addEventListener("click", () => {
        if(ToolStates.editor.active)
        {
            toggleToolStateInside(ToolStates.bucket, BucketButton); 
        }
        else
        {
            toggleToolState(ToolStates.bucket, BucketButton); //se maneja el resto en camera.js
        }
    });

    // ── Modo de Balde ──
    bucketModeCountry.addEventListener("change", () => {
        if (bucketModeCountry.checked) {
            bucketMode.FillCountry.active = true;
            bucketMode.FillContinuity.active = false;
        }
    });

    bucketModeContinuity.addEventListener("change", () => {
        if (bucketModeContinuity.checked) {
            bucketMode.FillCountry.active = false;
            bucketMode.FillContinuity.active = true;
        }
    });

    // ── Botón de Cuentagotas ──
    InkweelButton.addEventListener("click", () => {
        toggleToolState(ToolStates.inkweel, InkweelButton); //se maneja el resto en camera.js
    });
    
    // ── Botón de Laso ──
    LassoButton.addEventListener("click", () => {
        toggleToolState(ToolStates.lasso, LassoButton); //se maneja el resto en camera.js
        setPathCompleteCallback((path) => selectInsidePath(path));
    });

    // ── Botón de Corte ──
    CutButton.addEventListener("click", () => {
        toggleToolState(ToolStates.scissor, CutButton);
        const active = ToolStates.scissor.active;
        toggleScissorMode(active);
        if (active) setPathCompleteCallback(processCutPath);
    });

    // ── Botón Modo Editar ──
    EditorModeButton.addEventListener("click", () => {
        toggleToolState(ToolStates.editor, EditorModeButton);
        toggleMapEditor();
    });
    document.getElementById("ConfirmEditButton").addEventListener("click", confirmEdit);
    document.getElementById("CancelEditButton").addEventListener("click", cancelEdit);

    // Sincronizar inputs de color de agua al iniciar
    syncWaterColorInputs();

    document.getElementById("WrapButton").addEventListener("click", () => {
        state.wrapHorizontal = !state.wrapHorizontal;
        renderFromBase();
    });
}

// =======================
// PERSISTENCIA
// =======================

function saveMapProvinces(logicCanvas, img) {
    const obj  = lightSaveObject(logicCanvas, img);
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = "provinces.json";
    a.click();
    URL.revokeObjectURL(url);
    console.log("Mapa guardado");
}

function lightSaveObject(logicCanvas, img) {
    const provinces = {};
    Object.keys(provinceData).forEach(id => {
        const pd = provinceData[id];
        provinces[id] = {
            id:         pd.id,
            name:       pd.name,
            owner:      pd.owner,
            isWater:    pd.isWater,
            paintColor: pd.paintColor,
            colorKey:   pd.colorKey,
        };
    });
    return {
        meta: {
            width:     logicCanvas.width,
            height:    logicCanvas.height,
            imgSrc:    img.src,
            timestamp: Date.now(),
        },
        provinces,
    };
}

function clearMapProvinces() {
    Object.keys(provinceData).forEach(id => {
        if (provinceData[id].isWater) return;
        provinceData[id].paintColor = [...colorInicial];
    });
    state.baseCleanImageData = createBaseMap();
    addBorders();
    renderFromBase();
}

function applyProvinceData(data) {
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
    });
    console.log("Mapa cargado");
}

function exportFullMap(filename = "map.png") {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width  = state.baseCleanImageData.width;
    exportCanvas.height = state.baseCleanImageData.height;
    exportCanvas.getContext("2d").putImageData(state.baseCleanImageData, 0, 0);

    const a = document.createElement("a");
    a.href     = exportCanvas.toDataURL("image/png");
    a.download = filename;
    a.click();
}

export function updateMapPreview() {
    const preview = document.getElementById("mapPreview");
    if (!preview || !state.baseCleanImageData) return;

    // Dimensiones reales del mapa
    const w = state.baseCleanImageData.width;
    const h = state.baseCleanImageData.height;

    preview.width  = w;
    preview.height = h;

    preview.getContext("2d").putImageData(state.baseCleanImageData, 0, 0);
}

const popup    = document.getElementById("optionsPopup");
const openBtn  = document.getElementById("OptionsButton");
const closeBtn = document.getElementById("closePopup");

openBtn.addEventListener("click",  () => popup.classList.remove("hidden"));
closeBtn.addEventListener("click", () => popup.classList.add("hidden"));

// Cerrar al clickear el fondo oscuro
popup.addEventListener("click", e => {
    if (e.target === popup) popup.classList.add("hidden");
});

//con delay porque sino se dispara muchas times
let resizeTimeout = null;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        bufferToScreen(canvas);
        updateCameraViewport(canvas, utils);
        renderFromBase();
    }, 100);
});

const refInput   = document.getElementById("AddRefImage");
const refPreview = document.getElementById("RefImagePreview");

refInput.addEventListener("change", () => {
    const file = refInput.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    refPreview.onload = () => URL.revokeObjectURL(url);
    refPreview.src = url;

    refInput.value = "";
});