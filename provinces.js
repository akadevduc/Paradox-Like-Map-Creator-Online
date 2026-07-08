import{ canvas, ctx, logicCanvas, logicCtx,
        canvasRender, ctxRender,
        waterCanvas, waterCtx,
        overlayCanvas, overlayCtx }                  from "./main.js";
import{ state, overlayLayers, waterLayers,
        waterColor, colorToProvince,
        provinceData, provincePixels,
        colorInicial, colorResaltado,
        provinceMapOpacity, setProvinceMapOpacity,
        nextProvinceId, bumpProvinceId, brushColor }             from "./state.js";
import{ camera }                                     from "./camera.js";
import{ ToolStates, updateMapPreview }                                from "./ui.js";

// =======================
// CANVAS PERSISTENTES
// Declarados una sola vez, nunca se recrean en cada frame
// =======================
const provinceCanvas = document.createElement("canvas");
const provinceCtx    = provinceCanvas.getContext("2d");

const borderCanvas   = document.createElement("canvas");
const borderCtx      = borderCanvas.getContext("2d");

// Índices de píxeles que son borde — calculado UNA VEZ en buildBorderCache()
let borderCache = null;

// =======================
// CAPAS DE RELIEVE (overlay)
// =======================

export function rebuildOverlayCanvas() {
    /*
    if (overlayCanvas.width === 0) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.imageSmoothingEnabled = true;
    overlayCtx.imageSmoothingQuality = "high";
    for (const layer of overlayLayers) {
        if (!layer.visible || !layer.img) continue;
        overlayCtx.globalAlpha = layer.opacity;
        overlayCtx.drawImage(layer.img, 0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    overlayCtx.globalAlpha = 1.0;
    */
}

export function setLayerOpacity(name, opacity) {
    const layer = overlayLayers.find(l => l.name === name);
    if (!layer) return console.warn("Capa no encontrada:", name);
    layer.opacity = Math.max(0, Math.min(1, opacity));
    rebuildOverlayCanvas();
    renderFromBase();
}

export function setLayerVisibility(name, visible) {
    const layer = overlayLayers.find(l => l.name === name);
    if (!layer) return console.warn("Capa no encontrada:", name);
    layer.visible = visible;
    rebuildOverlayCanvas();
    renderFromBase();
}

export function removeOverlayLayer(name) {
    const idx = overlayLayers.findIndex(l => l.name === name);
    if (idx === -1) return console.warn("Capa no encontrada:", name);
    overlayLayers.splice(idx, 1);
    rebuildOverlayCanvas();
    renderFromBase();
}

// =======================
// CAPAS DE AGUA
// =======================

export async function loadWaterLayers() {
    await Promise.all(waterLayers.map(layer => new Promise(resolve => {
        const image = new Image();
        image.onload  = () => { layer.img = image; resolve(); };
        image.onerror = () => { console.warn("No se pudo cargar capa de agua:", layer.src); resolve(); };
        image.src = layer.src;
    })));
    waterCanvas.width  = overlayCanvas.width;
    waterCanvas.height = overlayCanvas.height;
    rebuildWaterLayer();
}

export function rebuildWaterLayer() {
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

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 10) continue;
        data[i]     = waterColor.rgb[0];
        data[i + 1] = waterColor.rgb[1];
        data[i + 2] = waterColor.rgb[2];
    }

    waterCtx.clearRect(0, 0, w, h);
    waterCtx.putImageData(imageData, 0, 0);
}

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
    const imageData = logicCtx.getImageData(0, 0, logicCanvas.width, logicCanvas.height);
    const data = imageData.data;

    // Registrar el océano una sola vez como provincia especial
    const oceanKey = -1;
    if (!colorToProvince[oceanKey]) {
        const newId = bumpProvinceId();
        colorToProvince[oceanKey] = newId;
        provinceData[newId] = {
            id:        newId,
            colorKey:  oceanKey,
            owner:     null,
            name:      "Océano",
            paintColor:[0, 0, 0],
            isWater:   true,
            isOcean:   true,
        };
        provincePixels[newId] = [];
    }

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) {
            // Píxel de agua — registrar en la provincia océano
            provincePixels[colorToProvince[oceanKey]].push(i);
            continue;
        }

        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = (r << 16) | (g << 8) | b;

        if (!colorToProvince[key]) {
            const newId = bumpProvinceId();
            colorToProvince[key] = newId;
            if (!state.loaded) {
                provinceData[newId] = {
                    id:         newId,
                    colorKey:   key,
                    owner:      null,
                    name:       `Provincia ${newId}`,
                    RGO:        0,
                    POP:        0,
                    paintColor: [...colorInicial],
                    isWater:    false,
                };
            }
            provincePixels[newId] = [];
        }

        const id = colorToProvince[key];
        if (!provincePixels[id]) provincePixels[id] = [];
        provincePixels[id].push(i);
    }

    console.log("Provincias detectadas:", nextProvinceId - 1);
}

// =======================
// BORDER CACHE
// Calcula UNA SOLA VEZ qué píxeles son borde y los guarda.
// Dibuja los bordes en borderCanvas (fondo transparente).
// No se vuelve a llamar al pintar provincias.
// =======================

export function buildBorderCache(colorBorde = [20, 20, 20]) {
    const src    = state.baseCleanImageData;
    const width  = src.width;
    const height = src.height;
    const data   = src.data;

    const found = new Int32Array(src.data.length / 4); // tamaño máximo posible
    let foundCount = 0;

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // transparente = agua, ignorar

        const px = i / 4;
        const x  = px % width;
        const y  = Math.floor(px / width);
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) continue;

        const r = data[i], g = data[i + 1], b = data[i + 2];

        if (data[i + 4]            !== r || data[i + 5]            !== g || data[i + 6]            !== b ||
            data[i - 4]            !== r || data[i - 3]            !== g || data[i - 2]            !== b ||
            data[i - width * 4]     !== r || data[i - width * 4 + 1] !== g || data[i - width * 4 + 2] !== b ||
            data[i + width * 4]     !== r || data[i + width * 4 + 1] !== g || data[i + width * 4 + 2] !== b) {
            found[foundCount++] = i;
        }
    }

    borderCache = new Int32Array(found);

    borderCanvas.width  = width;
    borderCanvas.height = height;
    const borderImageData = borderCtx.createImageData(width, height);
    const bd = borderImageData.data;

    for (let k = 0; k < borderCache.length; k++) {
        const i  = borderCache[k];
        bd[i]     = colorBorde[0];
        bd[i + 1] = colorBorde[1];
        bd[i + 2] = colorBorde[2];
        bd[i + 3] = 60;
    }

    borderCtx.putImageData(borderImageData, 0, 0);
    borderCache = found.slice(0, foundCount); // recortar al tamaño real
    console.log(`Border cache: ${borderCache.length} píxeles de borde`);
}

// =======================
// RENDER
// =======================

export function createBaseMap() {
    const imageData = logicCtx.getImageData(0, 0, logicCanvas.width, logicCanvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        const provinceId = colorToProvince[key];

        if (!provinceId) {
            data[i + 3] = 0;
            continue;
        }

        if (provinceData[provinceId].isOcean) {
            data[i + 3] = 0;  // mantener transparente
            continue;
        }

        const color = provinceData[provinceId].paintColor;
        data[i]     = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = provinceData[provinceId].isWater
            ? Math.round(provinceMapOpacity * 0.6 * 255)
            : Math.round(provinceMapOpacity * 255);
    }

    return imageData;
}

export function renderFromBase(imageData = state.baseImageData) {

    if (ToolStates.editor?.active) return;
    // Fondo negro fuera del mapa (zoom out / pan)
    ctx.fillStyle = "#0e0e18";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Redimensionar canvasRender solo si cambió el tamaño
    if (canvasRender.width !== imageData.width || canvasRender.height !== imageData.height) {
        canvasRender.width  = imageData.width;
        canvasRender.height = imageData.height;
    }

    ctxRender.clearRect(0, 0, canvasRender.width, canvasRender.height);

    // 1. Relieve o fondo blanco
    if (overlayLayers.some(l => l.visible && l.img)) {
        for (const layer of overlayLayers) {
            if (!layer.visible || !layer.img) continue;

            ctxRender.globalAlpha = layer.opacity;

            const scaleX = layer.img.width  / logicCanvas.width;
            const scaleY = layer.img.height / logicCanvas.height;

            const srcX = Math.max(0, camera.x * scaleX);
            const srcY = Math.max(0, camera.y * scaleY);
            const srcW = Math.min(layer.img.width  - srcX, (canvas.width  / camera.zoom) * scaleX);
            const srcH = Math.min(layer.img.height - srcY, (canvas.height / camera.zoom) * scaleY);

            // destino en coordenadas absolutas del mapa
            const dstX = Math.max(0, camera.x);
            const dstY = Math.max(0, camera.y);
            const dstW = canvas.width  / camera.zoom;
            const dstH = canvas.height / camera.zoom;

            console.log(
                "layer.img.width: " + layer.img.width, "logicCanvas.width: " + logicCanvas.width, "layer.img.height: " + layer.img.height, "logicCanvas.height: " + logicCanvas.height, 
                "scaleX: " + scaleX, "scaleY: " + scaleY, "srcX: " + srcX, "srcY: " + srcY, "srcW: " + srcW, "srcH: " + srcH, "camera.zoom: " + camera.zoom, "camera.x " + camera.x, "camera.y: " + camera.y
            );

            ctxRender.drawImage(
                layer.img, 
                srcX, srcY, srcW, srcH, 
                0, 0, canvasRender.width, canvasRender.height
            );
        }
        ctxRender.globalAlpha = 1.0;
        
    } else {
        ctxRender.fillStyle = "#ffffff";
        ctxRender.fillRect(0, 0, canvasRender.width, canvasRender.height);
    }
            
    // 2. Agua
    if (waterLayers.some(l => l.visible && l.img)) {
        ctxRender.drawImage(waterCanvas, 0, 0);
    }

    // 3. Provincias — canvas persistente, no se crea en cada frame
    if (provinceCanvas.width !== imageData.width || provinceCanvas.height !== imageData.height) {
        provinceCanvas.width  = imageData.width;
        provinceCanvas.height = imageData.height;
    }
    provinceCtx.putImageData(imageData, 0, 0);
    ctxRender.drawImage(provinceCanvas, 0, 0);

    // 4. Bordes — canvas estático, nunca se recalcula al pintar
    if (borderCanvas.width > 0) {
        ctxRender.drawImage(borderCanvas, 0, 0);
    }

    ctx.imageSmoothingEnabled = false;

    if (state.wrapHorizontal) {
        const mapW    = logicCanvas.width;
        const mapWpx  = mapW * camera.zoom;
        const rawX    = -camera.x * camera.zoom;
        const screenY = -camera.y * camera.zoom;

        // Normalizar rawX para que la copia central siempre esté
        // en el rango [-mapWpx, 0], pegada al borde izquierdo de pantalla
        const normalizedX = ((rawX % mapWpx) + mapWpx) % mapWpx - mapWpx;

        for (const k of [0, 1, 2]) {
            ctx.drawImage(
                canvasRender,
                normalizedX + k * mapWpx,
                screenY,
                mapWpx,
                logicCanvas.height * camera.zoom
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
}

export function renderHighlight(ids) {

    const idList = Array.isArray(ids) ? ids : [ids];

    if (!state.highlightImageData) {
        const src = state.baseCleanImageData;
        state.highlightImageData = new ImageData(
            new Uint8ClampedArray(src.data), src.width, src.height
        );
    } else {
        state.highlightImageData.data.set(state.baseImageData.data);
    }

    const data = state.highlightImageData.data;

    for (const id of idList) {
        if (!provincePixels[id]) continue;
        const color = provinceData[id].paintColor;
        provincePixels[id].forEach(i => {
            data[i]     = Math.max(0, color[0] - colorResaltado[0]);
            data[i + 1] = Math.max(0, color[1] - colorResaltado[1]);
            data[i + 2] = Math.max(0, color[2] - colorResaltado[2]);
        });
    }

    renderFromBase(state.highlightImageData);
}

// =======================
// ACTUALIZAR COLOR — NO llama a addBorders
// =======================

export function updateBaseMapColor(provinceId) {
    const data  = state.baseCleanImageData.data;
    const color = provinceData[provinceId].paintColor;
    const alpha = provinceData[provinceId].isWater
        ? Math.round(provinceMapOpacity * 0.6 * 255)
        : Math.round(provinceMapOpacity * 255);

    provincePixels[provinceId].forEach(i => {
        data[i]     = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = alpha;
    });

    // Sincronizar baseImageData (sin bordes, los bordes están en borderCanvas)
    state.baseImageData = new ImageData(
        new Uint8ClampedArray(state.baseCleanImageData.data),
        state.baseCleanImageData.width,
        state.baseCleanImageData.height
    );
}

export function setProvinceOpacity(opacity) {
    setProvinceMapOpacity(opacity);
    state.baseCleanImageData = createBaseMap();
    state.baseImageData = new ImageData(
        new Uint8ClampedArray(state.baseCleanImageData.data),
        state.baseCleanImageData.width,
        state.baseCleanImageData.height
    );
    renderFromBase();
}

// addBorders se mantiene con el mismo nombre para no romper llamadas desde main.js y ui.js
// internamente delega a buildBorderCache
export function addBorders() {
    buildBorderCache();
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

        const pixels = provincePixels[id];
        for (let k = 0; k < pixels.length; k++) {
            const i = pixels[k];
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

    addBorders();
    renderFromBase();
}