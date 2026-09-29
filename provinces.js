import{ canvas, ctx, logicCanvas, logicCtx,
        canvasRender, ctxRender,
        waterCanvas, waterCtx }                  from "./main.js";
import{ state, waterLayers,
        waterColor, colorToProvince,
        provinceData,
        colorInicial, colorResaltado,
        provinceMapOpacity, setProvinceMapOpacity,
        nextProvinceId, bumpProvinceId, brushColor }             from "./state.js";
import{ timerStart, timerEnd, memoryStart, memoryEnd, memoryReport } from "./utils.js";
import{ countries, rgbToHex }                                         from "./countries.js";
import{ ToolStates, updateMapPreview }                                from "./ui.js";
import{ camera }                                                      from "./camera.js";

// =======================
// CANVAS PERSISTENTES
// Declarados una sola vez, nunca se recrean en cada frame
// =======================
const provinceCanvas = document.createElement("canvas");
const provinceCtx    = provinceCanvas.getContext("2d");

const borderCanvas   = document.createElement("canvas");
const borderCtx      = borderCanvas.getContext("2d");

// Índices de píxeles que son borde — calculado UNA VEZ en buildBorderCache()
let borderCache = new Set(); // antes era Int32Array — Set permite borrar índices puntuales

// =======================
// MEMORY TRACKING
// =======================
// Registra la memoria antes/después de operaciones pesadas.
function memBefore(op)  { memoryStart(op); }
function memAfter(op)   { memoryEnd(op); memoryReport(op); }

// =======================
// CAPAS DE AGUA
// =======================

export async function loadWaterLayers() {
    memBefore("loadWaterLayers");
    timerStart("loadWaterLayers");
    await Promise.all(waterLayers.map(layer => new Promise(resolve => {
        const image = new Image();
        image.onload  = () => { layer.img = image; resolve(); };
        image.onerror = () => { console.warn("No se pudo cargar capa de agua:", layer.src); resolve(); };
        image.src = layer.src;
    })));
    waterCanvas.width  = logicCanvas.width;
    waterCanvas.height = logicCanvas.height;
    rebuildWaterLayer();
    state.canvasDirty = true;
    timerEnd("loadWaterLayers");
    memAfter("loadWaterLayers");
}

export function rebuildWaterLayer() {
    memBefore("rebuildWaterLayer");
    timerStart("rebuildWaterLayer");
    const w = waterCanvas.width;
    const h = waterCanvas.height;
    if (!w || !h) return;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width  = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = "high";

    for (const layer of waterLayers) {
        if (!layer.visible || !layer.img) continue;
        tempCtx.drawImage(layer.img, 0, 0, w, h);
    }

    const imageData = tempCtx.getImageData(0, 0, w, h);
    const data = imageData.data;

    let waterPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 10) continue;
        data[i]     = waterColor.rgb[0];
        data[i + 1] = waterColor.rgb[1];
        data[i + 2] = waterColor.rgb[2];
        waterPixels++;
    }
    console.log("[REBUILD_WATER_LAYER] waterPixels pintados:", waterPixels, "waterColor:", waterColor.rgb);

    waterCtx.clearRect(0, 0, w, h);
    waterCtx.putImageData(imageData, 0, 0);
    state.canvasDirty = true;
    timerEnd("rebuildWaterLayer");
    memAfter("rebuildWaterLayer");
}

// =======================
// NOTA: La generación de provincias de agua (ríos/lagos) se realiza
// desde una función externa usando una imagen base. Este módulo solo
// provee las utilidades de agua (carga de capas, renderizado).
// =======================

export function setWaterLayerVisibility(name, visible) {
    const layer = waterLayers.find(l => l.name === name);
    if (!layer) return console.warn("Capa de agua no encontrada:", name);
    layer.visible = visible;
    rebuildWaterLayer();
    renderFromBase();
}

// =======================
// BUILD PROVINCES
// =======================

export function buildProvinceData() {
    memBefore("buildProvinceData");
    timerStart("buildProvinceData");
    const imageData = logicCtx.getImageData(0, 0, logicCanvas.width, logicCanvas.height);
    const data = imageData.data;

    // Provincia especial para el océano (píxeles transparentes)
    const oceanKey = -1;
    let oceanId = null;
    if (!colorToProvince[oceanKey]) {
        oceanId = bumpProvinceId();
        colorToProvince[oceanKey] = oceanId;
        provinceData[oceanId] = {
            id:         oceanId,
            colorKey:   oceanKey,
            owner:      null,
            name:       "Océano",
            RGO:        0,
            POP:        0,
            paintColor: [...waterColor.rgb],
            isWater:    true,
        };
        // Marcar píxeles de océano en el array plano Uint32 (índice = i/4, valor = 0 = océano)
        // Cada posición en provincePixelIndices corresponde a un píxel (i/4)
        if (state.provincePixelIndices) {
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] === 0) {
                    state.provincePixelIndices[i / 4] = 0; // 0 = océano
                }
            }
        }
    } else {
        // Ya teníamos el océano mapeado; asegurarse de que provincePixelIndices esté inicializado
        if (!state.provincePixelIndices && colorToProvince[oceanKey]) {
            // nothing special needed aquí, se inicializará conforme aparezcan provincias
        }
    }

    // Recorrer todos los píxeles no transparentes y asignarles provincia
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // saltar píxeles oceánicos (ya marcados como 0)

        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = (r << 16) | (g << 8) | b;

        let id = colorToProvince[key];
        if (!id) {
            id = bumpProvinceId();
            colorToProvince[key] = id;
            if (!state.loaded) {
                provinceData[id] = {
                    id:         id,
                    colorKey:   key,
                    owner:      null,
                    name:       `Provincia ${id}`,
                    RGO:        0,
                    POP:        0,
                    paintColor: [...colorInicial],
                    isWater:    false,
                };
            }
        }

        // Marcar este píxel como perteneciente a 'id' en el array plano Uint32
        if (state.provincePixelIndices) {
            state.provincePixelIndices[i / 4] = id;
        }
    }

    console.log("Provincias detectadas:", nextProvinceId - 1, "(incluye océano:", oceanId ? "sí" : "no" + ")");
    timerEnd("buildProvinceData");
    memAfter("buildProvinceData");
}

// =======================
// BORDER CACHE
// Calcula UNA SOLA VEZ qué píxeles son borde y los guarda.
// Dibuja los bordes en borderCanvas (fondo transparente).
// No se vuelve a llamar al pintar provincias.
// =======================

export function buildBorderCache(colorBorde = [20, 20, 20], region = null) {
    memBefore("buildBorderCache");
    timerStart("buildBorderCache");

    const src    = state.baseCleanImageData;
    const width  = src.width;
    const height = src.height;
    const data   = src.data;

    // Si no hay región, es el rebuild completo (arranque de la app)
    const x0 = region ? Math.max(1, region.x0 - 1) : 1;
    const y0 = region ? Math.max(1, region.y0 - 1) : 1;
    const x1 = region ? Math.min(width  - 2, region.x1 + 1) : width  - 2;
    const y1 = region ? Math.min(height - 2, region.y1 + 1) : height - 2;

    const regionArea = (x1 - x0 + 1) * (y1 - y0 + 1);
    const totalArea  = width * height;
    const isFullRebuild = !region || regionArea > totalArea * 0.5; // ajustá el 0.5 a gusto

    if (isFullRebuild) borderCache.clear();

    const newBorderPixels = [];

    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const i = (y * width + x) * 4;

            if (!isFullRebuild) borderCache.delete(i); // solo borrar de a uno si la región es chica

            if (data[i + 3] === 0) continue;

            const r = data[i], g = data[i + 1], b = data[i + 2];

            if (data[i + 4]           !== r || data[i + 5]           !== g || data[i + 6]           !== b ||
                data[i - 4]           !== r || data[i - 3]           !== g || data[i - 2]           !== b ||
                data[i - width * 4]   !== r || data[i - width*4 + 1] !== g || data[i - width*4 + 2] !== b ||
                data[i + width * 4]   !== r || data[i + width*4 + 1] !== g || data[i + width*4 + 2] !== b) {
                borderCache.add(i);
                newBorderPixels.push(i);
            }
        }
    }

    if (borderCanvas.width !== width || borderCanvas.height !== height) {
        borderCanvas.width  = width;
        borderCanvas.height = height;
    }

    const rectW = x1 - x0 + 1;
    const rectH = y1 - y0 + 1;
    const borderImageData = borderCtx.createImageData(rectW, rectH);
    const bd = borderImageData.data;

    for (const i of newBorderPixels) {
        const px = i / 4;
        const x  = px % width;
        const y  = Math.floor(px / width);
        const localI = ((y - y0) * rectW + (x - x0)) * 4;
        bd[localI]     = colorBorde[0];
        bd[localI + 1] = colorBorde[1];
        bd[localI + 2] = colorBorde[2];
        bd[localI + 3] = 60;
    }

    borderCtx.putImageData(borderImageData, x0, y0); // solo repinta el rectángulo, no todo el canvas

    console.log(`Border cache: ${borderCache.size} píxeles totales (recalculados: ${newBorderPixels.length})`);
    timerEnd("buildBorderCache");
    memAfter("buildBorderCache");
}

// =======================
// RENDER
// =======================

export function createBaseMap() {
    memBefore("createBaseMap");
    timerStart("createBaseMap");
    const imageData = logicCtx.getImageData(0, 0, logicCanvas.width, logicCanvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        const provinceId = colorToProvince[key];

        if (!provinceId) {
            // Píxel transparente = océano → pintar con color de agua (opacidad completa)
            data[i]     = waterColor.rgb[0];
            data[i + 1] = waterColor.rgb[1];
            data[i + 2] = waterColor.rgb[2];
            data[i + 3] = Math.round(provinceMapOpacity * 255);
            continue;
        }

        const pd = provinceData[provinceId];
        if (pd.isWater && provinceId !== colorToProvince[-1]) {
            console.log("[CREATE_BASEMAP] Provincia agua pintada con 0.6x opacity - provinciaId:", provinceId, "isWater:", pd.isWater, "opacity:", Math.round(provinceMapOpacity * 0.6 * 255));
        }
/*
        if (provinceData[provinceId].isOcean) {
            data[i + 3] = 0;  // mantener transparente
            continue;
        }
*/
        const color = provinceData[provinceId].paintColor;
        data[i]     = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = provinceData[provinceId].isWater
            ? Math.round(provinceMapOpacity * 0.6 * 255)
            : Math.round(provinceMapOpacity * 255);
    }

    timerEnd("createBaseMap");
    memAfter("createBaseMap");
    return imageData;
}

function buildCanvasRender(imageData) {
    // Reconstruir cuando el contenido cambió (dirty) o cuando se dibuja
    // el highlight (imageData distinto al base). El highlight NO debe
    // saltarse por el cache de dirty, sino nunca se vería.
    if (!state.canvasDirty && imageData === state.baseCleanImageData) return;
    state.canvasDirty = false;

    if (canvasRender.width !== imageData.width || canvasRender.height !== imageData.height) {
        canvasRender.width  = imageData.width;
        canvasRender.height = imageData.height;
    }

    ctxRender.clearRect(0, 0, canvasRender.width, canvasRender.height);

    // Invalidar cache de scaling porque el contenido cambió
    state._cachedScaledCanvas = null;

    // 1. Fondo blanco (sin relieves)
    ctxRender.fillStyle = "#ffffff";
    ctxRender.fillRect(0, 0, canvasRender.width, canvasRender.height);

    // 2. Provincias — canvas persistente, no se crea en cada frame
    if (provinceCanvas.width !== imageData.width || provinceCanvas.height !== imageData.height) {
        provinceCanvas.width  = imageData.width;
        provinceCanvas.height = imageData.height;
    }
    provinceCtx.putImageData(imageData, 0, 0);
    ctxRender.drawImage(provinceCanvas, 0, 0);

    // 3. Agua (lagos y ríos) — encima de las provincias
    if (waterLayers.some(l => l.visible && l.img)) {
        ctxRender.drawImage(waterCanvas, 0, 0);
    }

    // 4. Bordes — canvas estático, nunca se recalcula al pintar
    if (borderCanvas.width > 0) {
        ctxRender.drawImage(borderCanvas, 0, 0);
    }
}

export function renderFromBase(imageData = state.baseCleanImageData, _skipTimer = false) {
    if (!_skipTimer) timerStart("renderFromBase");

    if (ToolStates.editor?.active) return;
    // Fondo negro fuera del mapa (zoom out / pan)
    ctx.fillStyle = "#0e0e18";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Reconstruir canvasRender solo si el contenido cambió (dirty)
    buildCanvasRender(imageData);

    ctx.imageSmoothingEnabled = false;

    if (state.wrapHorizontal) {
        const mapW    = logicCanvas.width;
        const mapWpx  = mapW * camera.zoom;
        const rawX    = -camera.x * camera.zoom;
        const screenY = -camera.y * camera.zoom;

        // Normalizar rawX para que la copia central siempre esté
        // en el rango [-mapWpx, 0], pegada al borde izquierdo de pantalla
        const normalizedX = ((rawX % mapWpx) + mapWpx) % mapWpx - mapWpx;

        // Cachear el canvasRender escalado si el zoom no cambió
        if (state._cachedZoom !== camera.zoom) {
            state._cachedZoom = camera.zoom;
            state._cachedScaledCanvas = null; // invalidar
        }
        if (!state._cachedScaledCanvas) {
            const sc = document.createElement("canvas");
            sc.width  = Math.ceil(mapWpx);
            sc.height = Math.ceil(logicCanvas.height * camera.zoom);
            const sctx = sc.getContext("2d");
            sctx.imageSmoothingEnabled = false;
            sctx.drawImage(
                canvasRender,
                0, 0, canvasRender.width, canvasRender.height,
                0, 0, sc.width, sc.height
            );
            state._cachedScaledCanvas = sc;
        }

        const sc = state._cachedScaledCanvas;
        for (const k of [0, 1, 2]) {
            ctx.drawImage(
                sc,
                normalizedX + k * mapWpx,
                screenY,
                sc.width,
                sc.height
            );
        }
    }
    else {
        ctx.drawImage(
            canvasRender,
            camera.x, camera.y,
            canvas.width  / camera.zoom,
            canvas.height / camera.zoom,
            0, 0,
            canvas.width, canvas.height
        );
    }
    updateMapPreview();
    if (!_skipTimer) timerEnd("renderFromBase");
}

export function renderHighlight(ids) {
    timerStart("renderHighlight");
    const idList = Array.isArray(ids) ? ids : [ids];

    // Si highlightImageData no existe o necesita refrescarse,
    // copiamos baseCleanImageData como base
    if (!state.highlightImageData) {
        const src = state.baseCleanImageData;
        state.highlightImageData = new ImageData(
            new Uint8ClampedArray(src.data), src.width, src.height
        );
    } else {
        // Refrescar desde baseCleanImageData en vez de baseImageData (que fue eliminado)
        state.highlightImageData.data.set(state.baseCleanImageData.data);
    }

    const data = state.highlightImageData.data;

    for (const id of idList) {
        // Ya no usamos provincePixels[id] (Map<id, [Array<indices>]>).
        // En su lugar, recorremos provincePixelIndices plano para encontrar
        // píxeles que pertenezcan a esta provincia (valor = id en posición i/4).
        if (!state.provincePixelIndices) continue;

        const color = provinceData[id]?.paintColor;
        if (!color) continue;

        // Recorrer todo el array plano y pintar los píxeles de esta provincia
        const pixelCount = state.provincePixelIndices.length;
        for (let p = 0; p < pixelCount; p++) {
            if (state.provincePixelIndices[p] === id) {
                const i = p * 4; // índice byte en el ImageData
                data[i]     = Math.max(0, color[0] - colorResaltado[0]);
                data[i + 1] = Math.max(0, color[1] - colorResaltado[1]);
                data[i + 2] = Math.max(0, color[2] - colorResaltado[2]);
            }
        }
    }

    renderFromBase(state.highlightImageData, true);

    // Marcar dirty para que el próximo renderFromBase(baseImageData)
    // (cuando el cursor salga de la provincia) reconstruya sin highlight.
    state.canvasDirty = true;
    timerEnd("renderHighlight");
    memAfter("renderHighlight");
}

// =======================
// ACTUALIZAR COLOR — NO llama a addBorders
// =======================

export function updateBaseMapColor(provinceId) {

    memBefore("updateBaseMapColor");
    timerStart("updateBaseMapColor");

    state.canvasDirty = true;
    const data  = state.baseCleanImageData.data;
    const color = provinceData[provinceId].paintColor;
    const alpha = provinceData[provinceId].isWater
        ? Math.round(provinceMapOpacity * 0.6 * 255)
        : Math.round(provinceMapOpacity * 255);

    // Actualizar píxeles usando provincePixelIndices plano (Uint32Array).
    // provincePixelIndices[posición] = ID de la provincia. Buscamos todas las
    // posiciones donde el valor sea provinceId y actualizamos su color.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

    if (state.provincePixelIndices) {
        const pixelCount = state.provincePixelIndices.length;
        for (let p = 0; p < pixelCount; p++) {
            if (state.provincePixelIndices[p] === provinceId) {
                const i = p * 4;
                data[i]     = color[0];
                data[i + 1] = color[1];
                data[i + 2] = color[2];
                data[i + 3] = alpha;

                const x = p % state.baseCleanImageData.width;
                const y = Math.floor(p / state.baseCleanImageData.width);
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }

    timerEnd("updateBaseMapColor");
    memAfter("updateBaseMapColor");

    // Sincronizar baseImageData (sin bordes, los bordes están en borderCanvas)
    state.baseCleanImageData = new ImageData(
        new Uint8ClampedArray(state.baseCleanImageData.data),
        state.baseCleanImageData.width,
        state.baseCleanImageData.height
    );

    return { x0, y0, x1, y1 };
}

export function setProvinceOpacity(opacity) {
    setProvinceMapOpacity(opacity);
    state.baseCleanImageData = createBaseMap();
    state.baseCleanImageData = new ImageData(
        new Uint8ClampedArray(state.baseCleanImageData.data),
        state.baseCleanImageData.width,
        state.baseCleanImageData.height
    );
    state.canvasDirty = true;
    renderFromBase();
}

// addBorders se mantiene con el mismo nombre para no romper llamadas desde main.js y ui.js
// internamente delega a buildBorderCache
export function addBorders(region = null) {
    buildBorderCache(undefined, region);
    state.canvasDirty = true;
}

export function arraysEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function fillContinuity(startProvinceId) {
    const targetColor = provinceData[startProvinceId].paintColor;
    const newColor    = [...brushColor.rgb]; // necesitás importar brushColor de state.js
    
    if (arraysEqual(targetColor, newColor)) return;

    const width     = logicCanvas.width;
    const logicData = logicCtx.getImageData(0, 0, width, logicCanvas.height).data;

    const visited = new Set();
    const queue   = [startProvinceId];

    while (queue.length > 0) {
        const id = queue.pop();
        if (visited.has(id)) continue;
        if (!provinceData[id]) continue;
        if (!arraysEqual(provinceData[id].paintColor, targetColor)) continue;

        visited.add(id);
        provinceData[id].paintColor = [...newColor];
        updateBaseMapColor(id);

        // Usar provincePixelIndices plano para encontrar píxeles vecinos
        if (state.provincePixelIndices) {
            const width = logicCanvas.width;
            const pixelCount = state.provincePixelIndices.length;
            for (let p = 0; p < pixelCount; p++) {
                if (state.provincePixelIndices[p] === id) {
                    const i = p * 4; // offset byte
                    const x = (i / 4) % width;
                    const y = Math.floor((i / 4) / width);

                    const neighbors = [
                        x > 0         ? i - 4        : -1,
                        x < width - 1 ? i + 4        : -1,
                        y > 0         ? i - width * 4 : -1,
                                        i + width * 4
                    ];

                    for (const ni of neighbors) {
                        if (ni < 0) continue;
                        const nKey = (logicData[ni] << 16) | (logicData[ni+1] << 8) | logicData[ni+2];
                        const nId  = colorToProvince[nKey];
                        if (nId && !visited.has(nId)) queue.push(nId);
                    }
                }
            }
        }
    }

    addBorders();
    renderFromBase();
}