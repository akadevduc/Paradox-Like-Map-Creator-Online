import { state, waterLayers, provinceData,
         colorToProvince, waterColor,
         brushColor, colorInicial, opacityStep,
         provinceMapOpacity, setProvinceMapOpacity,
         setWaterColor, waterColorListeners, Province
        }from "./state.js";

import { createBaseMap, addBorders,
         renderFromBase,
         rebuildWaterLayer, setProvinceOpacity 
        }from "./provinces.js";

import { registerCountry, selectCountryColor,
         renderCountryList, countries, rgbToHex,
         isCountryLocked, initCountriesFromProvinceData 
        }from "./countries.js";

import { loadMapProvinces, resetMapState,
         waterCtx, waterCanvas, setup, canvas,
         logicCanvas 
        }from "./main.js";

import { toggleScissorMode, initEditor, setPathCompleteCallback, processCutPath, paintAlongPath 
        }from "./tijerear.js";

import { initMapEditor, toggleMapEditor,
         floodFill, confirmEdit, cancelEdit
        }from "./editor.js";

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

const ChangeToStockBtn = document.getElementById("ChangeToStockButton");
const ChangeToGFMBtn   = document.getElementById("ChangeToGFMButton");
const ChangeToEU4Btn   = document.getElementById("ChangeToEU4Button");

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
    
    // ── Load SAVE ──

    // ============ Lector de saves de EU4 ============



    let eu4Countries = null;   // tag -> [r,g,b]   (EU4_countries.json)

    async function fetchJson(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
        return res.json();
    }

    async function loadEU4Reference() {
        if (!eu4Countries) eu4Countries = await fetchJson("maps_data/EU4_countries.json");
    }

    // Saca un archivo de adentro de un zip (los .eu4 comprimidos lo son)
    async function readZipEntry(buf, wanted) {
        const dv = new DataView(buf);
        let eocd = -1;
        for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error("Zip inválido");
        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        for (let n = 0; n < count; n++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method     = dv.getUint16(p + 10, true);
            const compSize   = dv.getUint32(p + 20, true);
            const nameLen    = dv.getUint16(p + 28, true);
            const extraLen   = dv.getUint16(p + 30, true);
            const commentLen = dv.getUint16(p + 32, true);
            const localPos   = dv.getUint32(p + 42, true);
            const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
            if (name === wanted) {
                const start = localPos + 30 + dv.getUint16(localPos + 26, true) + dv.getUint16(localPos + 28, true);
                const comp = new Uint8Array(buf, start, compSize);
                if (method === 0) return comp;
                if (method === 8) {
                    const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
                    return new Uint8Array(await new Response(stream).arrayBuffer());
                }
                throw new Error("Compresión no soportada: " + method);
            }
            p += 46 + nameLen + extraLen + commentLen;
        }
        throw new Error(`"${wanted}" no está dentro del zip`);
    }

    async function readEU4GameState(file) {
        const buf = await file.arrayBuffer();
        const head = new Uint8Array(buf, 0, 2);
        const bytes = (head[0] === 0x50 && head[1] === 0x4B)   // "PK" = zip
            ? await readZipEntry(buf, "gamestate")
            : new Uint8Array(buf);                              // save sin comprimir
        const text = new TextDecoder("windows-1252").decode(bytes);
        if (text.startsWith("EU4bin")) throw new Error("Save Ironman (binario): no soportado");
        return text;
    }

    // Recorre un bloque de provincia y devuelve su owner de primer nivel
    // (ignora los owner de adentro de history y keys como original_owner)
    const SAVE_KEYS = {
        o: ["owner"],
        c: ["controller", "culture"],
        t: ["trade_goods"],
        b: ["base_tax", "base_production", "base_manpower"],
        r: ["religion"],
    };

    function scanProvince(text, start) {
        let depth = 0;
        const values = {};
        for (let i = start; i < text.length; i++) {
            const c = text.charCodeAt(i);
            if (c === 123) depth++;                      // {
            else if (c === 125) {                        // }
                depth--;
                if (depth === 0) return { values, end: i + 1 };
            } else if (depth === 1 && (c === 9 || c === 10 || c === 32)) {   // una clave empieza después de tab/salto/espacio
                const keys = SAVE_KEYS[text[i + 1]];
                if (!keys) continue;
                for (const key of keys) {
                    if (key in values || !text.startsWith(key + "=", i + 1)) continue;
                    const p = i + key.length + 2;
                    if (text[p] === '"') {
                        values[key] = text.slice(p + 1, text.indexOf('"', p + 1));
                    } else {
                        let q = p;
                        while (q < text.length) {
                            const d = text.charCodeAt(q);
                            if (d <= 32 || d === 125) break;
                            q++;
                        }
                        values[key] = text.slice(p, q);
                    }
                    break;
                }
            }
        }
        return { values, end: text.length };
    }

    // Devuelve Map<idProvincia, tag>
    function extractProvinceOwners(text) {
        const tag = "\nprovinces={";
        let pos = text.indexOf(tag);
        if (pos < 0) throw new Error("No se encontró la sección provinces en el save");
        pos += tag.length;

        const owners = new Map();
        const header = /-?(\d+)=\{/y;                    // en el save las provincias son -1={, -2={, ...
        while (pos < text.length) {
            let c = text.charCodeAt(pos);
            while (c === 32 || c === 9 || c === 10 || c === 13) c = text.charCodeAt(++pos);
            if (c === 125) break;                        // cierre de provinces
            header.lastIndex = pos;
            const m = header.exec(text);
            if (!m) break;
            const { values, end } = scanProvince(text, pos + m[0].length - 1);
            owners.set(parseInt(m[1]), values);
            pos = end;
        }
        return owners;
    }

    function blockEnd(text, open) {
        let depth = 0;
        for (let i = open; i < text.length; i++) {
            const c = text.charCodeAt(i);
            if (c === 123) depth++;
            else if (c === 125 && --depth === 0) return i;
        }
        return text.length;
    }

    // Color que el juego muestra para un país (colonias, revolucionarios...), sacado de su bloque en el save
    function findCountryMapColor(text, tag) {
        const section = text.indexOf("\ncountries={");
        if (section < 0) return null;
        const header = `\n\t${tag}={`;
        const at = text.indexOf(header, section);
        if (at < 0) return null;
        const open = at + header.length - 1;
        const end = blockEnd(text, open);
        const idx = text.indexOf("map_color", open);
        if (idx < 0 || idx > end) return null;
        const m = /map_color\s*=\s*\{\s*(\d+)\s+(\d+)\s+(\d+)/.exec(text.slice(idx, idx + 120));
        return m ? [+m[1], +m[2], +m[3]] : null;
    }

    function fallbackColor(tag) {                        // color estable para tags sin color conocido
        let h = 0;
        for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
        return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    }

    async function readEU4Save(file) {
        if (state.activeMapId !== "EU4") {
            throw new Error(`El mapa activo es "${state.activeMapId}", no EU4`);
        }
        await loadEU4Reference();
        const text = await readEU4GameState(file);
        const owners = extractProvinceOwners(text);      // id -> valores de la provincia en el save

        const saveColors = new Map();                    // tag -> color sacado del save (cache)
        const unknown = new Set();
        const provinces = {};
        for (const id of Object.keys(provinceData)) {
            const old = provinceData[id];
            const info = owners.get(parseInt(id));
            let owner = null, occuper = null, paintColor;

            if (old.isWater) {                           // agua -> tu país agua
                paintColor = [...waterColor.rgb];
            } else if (info?.owner) {                    // provincia con dueño
                owner   = info.owner;
                occuper = info.controller ?? null;
                let rgb = eu4Countries[owner];
                if (!rgb) {                              // país creado en la partida: color del save
                    if (!saveColors.has(owner)) saveColors.set(owner, findCountryMapColor(text, owner));
                    rgb = saveColors.get(owner);
                }
                if (!rgb) { unknown.add(owner); rgb = fallbackColor(owner); }
                paintColor = [...rgb];
            } else {                                     // wasteland / sin colonizar
                paintColor = [...colorInicial];
            }

            const extra = (info && !old.isWater) ? {
                tradeGoods:     info.trade_goods ?? null,
                baseTax:        Math.round(parseFloat(info.base_tax)) || 0,
                baseProduction: Math.round(parseFloat(info.base_production)) || 0,
                baseManpower:   Math.round(parseFloat(info.base_manpower)) || 0,
                religion:       info.religion ?? null,
                culture:        info.culture ?? null,
            } : {};
            provinces[id] = { ...old, ...extra, owner, occuper, paintColor };
        }

        if (unknown.size) console.warn("Tags sin color (ni json ni save):", [...unknown].join(", "));
        console.log(`Save leído: ${owners.size} provincias`);
        return { provinces };
    }

    loadSaveButton.addEventListener("click", async () => {
        const fileInput = document.getElementById("loadSaveMap");
        const file = fileInput.files[0];
        if (!file) return;
        try {
            const data = await readEU4Save(file);
            applyProvinceData(data);
            initCountriesFromProvinceData();
            state.highlightImageData = null;
            state.baseCleanImageData = createBaseMap();
            addBorders();
            renderFromBase();
        } catch (err) {
            console.error("Save inválido:", err);
        }
    });

    document.querySelector("#loadSaveMap").onchange = function() {
        const fileName = this.files[0]?.name;
        document.querySelector("label[for=loadSaveMap]").innerText = fileName ?? "Browse Files";
    };

    // ── Cambios de mapa ──

    async function switchMap(Map_state) {
        state.activeMapId = Map_state.id; //redundante?
        state.highlightImageData = null;

        console.log("Modo "+Map_state.name);

        img.src = Map_state.imgSrc;
        await img.decode();

        resetMapState();

        logicCanvas.getContext("2d").clearRect(0, 0, logicCanvas.width, logicCanvas.height);

        /* cuando habían capas de agua solapadas, actualmente no se usa pero lo dejo por si acaso
        if (state.legacy) {
            waterLayers.forEach(l => { l.img = null; l.visible = false; });
            waterCtx.clearRect(0, 0, waterCanvas.width, waterCanvas.height);
        } else {
            waterLayers.forEach(l => { l.visible = true; });
        }*/

        await setupFn(Map_state.jsonSrc);
        console.log("canvas size después de setup:", canvas.width, canvas.height);
    };

    ChangeToGFMBtn.addEventListener("click", () => switchMap(state.gfm_map));
    ChangeToEU4Btn.addEventListener("click", () => switchMap(state.eu4_map));
    ChangeToStockBtn.addEventListener("click", () => switchMap(state.stock_map));

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
    obj.mapType = state.activeMapId;   // tipo de mapa con el que se creó
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
        provinceData[id] = Province.fromData(id, pd);
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