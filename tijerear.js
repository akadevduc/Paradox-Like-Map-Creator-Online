import { canvas, ctx, logicCanvas, logicCtx }  from "./main.js";
import { state, colorToProvince, provinceData,
         provincePixels, bumpProvinceId,
         colorInicial, brushColor }                        from "./state.js";
import { camera }                              from "./camera.js";
import { buildBorderCache, createBaseMap,
         renderFromBase, updateBaseMapColor }                      from "./provinces.js";
import { ToolStates }                          from "./ui.js";
// =======================
// ESTADO
// =======================

// Canvas transparente encima del mapa, solo para dibujar la línea de corte
export const cutOverlayCanvas = document.createElement("canvas");
const cutCtx = cutOverlayCanvas.getContext("2d");

// Path en coordenadas del MUNDO (no de pantalla)
let cutPath   = [];
let isDrawing = false;

// =======================
// INICIALIZACIÓN
// =======================

export function initEditor() {
    // Solo agregar al DOM si no está ya
    if (!document.getElementById("cutOverlayCanvas")) {
        canvas.parentElement.appendChild(cutOverlayCanvas);
    }
    
  //cutOverlayCanvas.id     = "cutOverlayCanvas";
    cutOverlayCanvas.width  = canvas.width;
    cutOverlayCanvas.height = canvas.height;

    canvas.parentElement.style.position = "relative";
    cutOverlayCanvas.style.position     = "absolute";
    cutOverlayCanvas.style.top          = canvas.offsetTop  + "px";
    cutOverlayCanvas.style.left         = canvas.offsetLeft + "px";
    cutOverlayCanvas.style.pointerEvents = "none";
    canvas.parentElement.appendChild(cutOverlayCanvas);

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup",   onMouseUp);
}

export function toggleScissorMode(active) {
    console.log("toggleScissorMode llamado, active:", active, "ToolStates.scissor antes:", ToolStates.scissor.active);
    canvas.style.cursor = active ? "crosshair" : "default";
    if (!active) clearOverlay();
}

// =======================
// EVENTOS DEL MOUSE
// =======================

function onMouseDown(e) {
    console.log("mousedown tijerear, ToolStates.scissor:", ToolStates.scissor.active);
    if (!ToolStates.scissor.active && !ToolStates.paint.active) return;
    isDrawing = true;
    cutPath   = [];
    cutPath.push(screenToWorld(e.offsetX, e.offsetY));
}

function onMouseMove(e) {
    if (!ToolStates.scissor.active && !ToolStates.paint.active) return;//isDrawing
    console.log("mousemove tijerear, ToolStates.scissor:", ToolStates.scissor.active, "ToolStates.paint:", ToolStates.paint.active);

    const world = screenToWorld(e.offsetX, e.offsetY);
    const last  = cutPath[cutPath.length - 1];

    // Ignorar si no se movió al menos 1px en algún eje
    if (!last || (Math.abs(world.x - last.x) < 1 && Math.abs(world.y - last.y) < 1)) return;

    // Después de 10 puntos, chequear si el path se cruzó a sí mismo
    if (cutPath.length > 10) {
        const intersection = findSelfIntersection(world);
        if (intersection) {
            handleSelfClose(intersection);
            return;
        }
    }

    cutPath.push(world);
    drawCutLine();
}
// en lugar de llamar siempre a processCutPath en onMouseUp:
let onPathComplete = null;

export function setPathCompleteCallback(fn) {
    onPathComplete = fn;
}

function onMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    if (cutPath.length < 4) { clearOverlay(); return; }
    
    if (onPathComplete) {
        onPathComplete([...cutPath]);
    }
    clearOverlay();
}

// =======================
// DETECCIÓN DE AUTOINTERSECCIÓN
// =======================

// Devuelve el punto de intersección si los segmentos p1→p2 y p3→p4 se cruzan, o null
function segmentIntersection(p1, p2, p3, p4) {
    const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
    const dx2 = p4.x - p3.x, dy2 = p4.y - p3.y;
    const denom = dx1 * dy2 - dy1 * dx2;

    if (Math.abs(denom) < 0.0001) return null; // paralelos

    const dx3 = p3.x - p1.x, dy3 = p3.y - p1.y;
    const t = (dx3 * dy2 - dy3 * dx2) / denom;
    const u = (dx3 * dy1 - dy3 * dx1) / denom;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
            x: p1.x + t * dx1,
            y: p1.y + t * dy1,
            pathIdx: null
        };
    }
    return null;
}

// Chequea si el segmento (último punto → newPoint) se cruza con algún segmento anterior
function findSelfIntersection(newPoint) {
    const last = cutPath[cutPath.length - 1];
    for (let i = 0; i < cutPath.length - 2; i++) {
        const pt = segmentIntersection(last, newPoint, cutPath[i], cutPath[i + 1]);
        if (pt) {
            pt.pathIdx = i;
            return pt;
        }
    }
    return null;
}

// Cuando el path se cruza a sí mismo, el polígono cerrado es cutPath[pathIdx..fin] + punto de intersección
function handleSelfClose(intersection) {
    const polygon = [
        ...cutPath.slice(intersection.pathIdx),
        { x: intersection.x, y: intersection.y }
    ];

    isDrawing = false;

    const logicData  = logicCtx.getImageData(0, 0, logicCanvas.width, logicCanvas.height);
    const provinceId = getDominantProvinceInPolygon(polygon, logicData);
    const anyChange  = provinceId
        ? applyCutClosed(polygon, logicData)
        : applyWaterEnclosure(polygon, logicData);

    if (anyChange) commitChanges(logicData);
    clearOverlay();
}

// La provincia con más puntos del path dentro de ella es la "dominante"
function getDominantProvinceInPolygon(polygon, logicData) {
    const counts = {};
    for (const pt of polygon) {
        const id = getProvinceAtPixel(pt.x, pt.y, logicData);
        if (id) counts[id] = (counts[id] || 0) + 1;
    }
    let best = null, bestCount = 0;
    for (const [id, count] of Object.entries(counts)) {
        if (count > bestCount) { bestCount = count; best = parseInt(id); }
    }
    return best;
}

// =======================
// DIBUJO DEL OVERLAY
// =======================

function drawCutLine() {
    cutOverlayCanvas.width = canvas.width; // resetea el canvas a transparente
    if (cutPath.length < 2) return;

    cutCtx.strokeStyle = "#ff0000";
    cutCtx.lineWidth   = 1.5;
    cutCtx.setLineDash([4, 3]);
    cutCtx.beginPath();

    const first = worldToScreen(cutPath[0]);
    cutCtx.moveTo(first.x, first.y);
    for (let i = 1; i < cutPath.length; i++) {
        const pt = worldToScreen(cutPath[i]);
        cutCtx.lineTo(pt.x, pt.y);
    }
    cutCtx.stroke();
}

function clearOverlay() {
    cutOverlayCanvas.width = canvas.width;
    cutPath   = [];
    isDrawing = false;
}

// =======================
// CONVERSIÓN DE COORDENADAS
// =======================

function screenToWorld(sx, sy) {
    return {
        x: Math.floor(camera.x + sx / camera.zoom),
        y: Math.floor(camera.y + sy / camera.zoom),
    };
}

function worldToScreen(pt) {
    return {
        x: (pt.x - camera.x) * camera.zoom,
        y: (pt.y - camera.y) * camera.zoom,
    };
}

// =======================
// PINCEL Y LASO
// =======================

export function paintAlongPath(path) {
    if (!path || path.length === 0) return;

    const logicData     = logicCtx.getImageData(0, 0, logicCanvas.width, logicCanvas.height);
    const pathProvinces = path.map(pt => getProvinceAtPixel(pt.x, pt.y, logicData));
    const segments      = segmentByProvince(pathProvinces);

    for (const seg of segments) {
        if (!seg.provinceId || !provinceData[seg.provinceId]) continue;
        if (provinceData[seg.provinceId].isOcean) continue;
        provinceData[seg.provinceId].paintColor = [...brushColor.rgb];
        updateBaseMapColor(seg.provinceId);
    }

    buildBorderCache();
    renderFromBase();
}

// =======================
// PROCESAR EL PATH
//
// 1. Para cada punto del path, determinar en qué provincia está
// 2. Segmentar por provincia
// 3. Validar cada segmento
// 4. Aplicar corte a los segmentos válidos
// =======================

export function processCutPath() {
    const logicData     = logicCtx.getImageData(0, 0, logicCanvas.width, logicCanvas.height);
    const pathProvinces = cutPath.map(pt => getProvinceAtPixel(pt.x, pt.y, logicData));
    const segments      = segmentByProvince(pathProvinces);

    let anyChange = false;

    for (const seg of segments) {
        const segPath = cutPath.slice(seg.startIdx, seg.endIdx + 1);

        if (!seg.provinceId) {
            // Segmento en agua — verificar si rodea islas
            if (applyWaterEnclosure(segPath, logicData)) anyChange = true;
            continue;
        }

        const cutType = validateSegment(seg, pathProvinces, segPath);
        if (!cutType) continue;

        if (applyCut(seg.provinceId, segPath, cutType, logicData)) anyChange = true;
    }

    if (anyChange) commitChanges(logicData);
}

// =======================
// SEGMENTACIÓN POR PROVINCIA
// Agrupa tramos consecutivos del path que están en la misma provincia
// =======================

function segmentByProvince(pathProvinces) {
    if (pathProvinces.length === 0) return [];

    const segments = [];
    let current = { provinceId: pathProvinces[0], startIdx: 0 };

    for (let i = 1; i < pathProvinces.length; i++) {
        if (pathProvinces[i] !== current.provinceId) {
            current.endIdx = i - 1;
            segments.push(current);
            current = { provinceId: pathProvinces[i], startIdx: i };
        }
    }
    current.endIdx = pathProvinces.length - 1;
    segments.push(current);

    return segments;
}

// =======================
// VALIDACIÓN DE SEGMENTO
//
// Transversal: entra desde otra provincia y sale hacia otra provincia
// =======================

function validateSegment(seg, pathProvinces, segPath) {
    const beforeIdx = seg.startIdx - 1;
    const afterIdx  = seg.endIdx   + 1;

    if (beforeIdx < 0 || afterIdx >= pathProvinces.length) return null;

    const provinceBefore = pathProvinces[beforeIdx];
    const provinceAfter  = pathProvinces[afterIdx];

    if (provinceBefore === seg.provinceId || provinceAfter === seg.provinceId) return null;

    return segPath.length >= 2 ? "transversal" : null;
}

// =======================
// APLICAR CORTE TRANSVERSAL
// Cierra el segmento artificialmente con el bounding box de la provincia
// y delega al scanline fill
// =======================

function applyCut(provinceId, segPath, cutType, logicData) {
    if (provinceData[provinceId]?.isOcean) return false;
    return applyCutTransversal(provinceId, segPath, logicData);
}

// =======================
// CORTE TRANSVERSAL — FLOOD FILL CON BORDES NATURALES
//
// El área a cortar está definida por cualquier combinación de:
//   - el corte del usuario
//   - bordes entre provincias distintas
//   - la costa (borde con agua)
//
// La máscara tiene tres valores:
//   0 = agua (no es tierra, no se procesa)
//   1 = tierra de la provincia que estamos cortando
//   2 = barrera: el corte del usuario + píxeles donde cambia el color de provincia
//
// El seed es el centroide del path — debería estar dentro del área cerrada
// que el usuario quiso crear. El flood fill desde ahí encuentra exactamente
// esa área sin importar si está conectada por tierra o no.
// =======================

function applyCutTransversal(provinceId, segPath, logicData) {
    const width  = logicCanvas.width;
    const height = logicCanvas.height;
    const logicD = logicData.data;

    // Máscara
    const mask = new Uint8Array(width * height);

    // Marcar píxeles de la provincia como 1
    const pixels = provincePixels[provinceId];
    for (let k = 0; k < pixels.length; k++) {
        mask[pixels[k] / 4] = 1;
    }

    // Marcar bordes naturales como 2:
    // un píxel de tierra es borde si alguno de sus 4 vecinos tiene distinto color
    // (otra provincia o agua — ambos actúan como pared)
    for (let k = 0; k < pixels.length; k++) {
        const pixIdx = pixels[k] / 4;
        const x = pixIdx % width;
        const y = Math.floor(pixIdx / width);

        const r = logicD[pixels[k]];
        const g = logicD[pixels[k] + 1];
        const b = logicD[pixels[k] + 2];

        let isBorder = false;

        // Chequear los 4 vecinos
        const neighbors = [
            x > 0          ? pixIdx - 1     : -1,
            x < width - 1  ? pixIdx + 1     : -1,
            y > 0          ? pixIdx - width  : -1,
            y < height - 1 ? pixIdx + width  : -1,
        ];

        for (const n of neighbors) {
            if (n === -1) { isBorder = true; break; } // borde del mapa
            const ni = n * 4;
            if (logicD[ni + 3] === 0) { isBorder = true; break; } // agua
            if (logicD[ni] !== r || logicD[ni+1] !== g || logicD[ni+2] !== b) {
                isBorder = true; break; // otra provincia
            }
        }

        if (isBorder) mask[pixIdx] = 2;
    }

    // Rasterizar el corte del usuario como barrera adicional
    rasterizePath(segPath, mask, width, height, "transversal");

    // Seed: centroide del path
    // Es el punto más probable de estar dentro del área que el usuario quiso cerrar
    const cx = Math.floor(segPath.reduce((s, p) => s + p.x, 0) / segPath.length);
    const cy = Math.floor(segPath.reduce((s, p) => s + p.y, 0) / segPath.length);

    // Buscar el píxel con valor 1 más cercano al centroide en espiral
    let seedIdx = null;
    outer: for (let r = 0; r < 50; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const nx = cx + dx, ny = cy + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    if (mask[ny * width + nx] === 1) {
                        seedIdx = ny * width + nx;
                        break outer;
                    }
                }
            }
        }
    }

    if (seedIdx === null) return false;

    // Flood fill desde el seed — se expande por los 1s, los 2s son paredes
    const group = floodFillWithBorder(mask, seedIdx, width, height);
    if (group.size === 0) return false;

    // Si el grupo es toda la provincia, el corte no cerró ningún área
    if (group.size >= pixels.length) return false;

    return createProvinceFromPixelSet(group, provinceId, logicData);
}

// =======================
// CORTE CERRADO — SCANLINE FILL
//
// Rellena el polígono fila por fila. Para cada fila Y, calcula los cruces
// del polígono con esa fila y marca los píxeles entre cada par de cruces.
// Filtra solo píxeles con tierra y agrupa por provincia.
// Cada provincia con píxeles dentro → nueva provincia.
// El agua se ignora automáticamente.
// Lo que queda dentro del polígono pasa a la nueva provincia sin importar
// si está conectado por tierra o no (islas y archipiélagos incluidos).
// =======================

function applyCutClosed(polygon, logicData) {
    const width  = logicCanvas.width;
    const height = logicCanvas.height;
    const logicD = logicData.data;

    // Bounding box del polígono
    let minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity;
    for (const pt of polygon) {
        if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
        if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(height - 1, Math.ceil(maxY));
    minX = Math.max(0, Math.floor(minX));
    maxX = Math.min(width - 1, Math.ceil(maxX));

    const n              = polygon.length;
    const provinceGroups = new Map(); // provinceId → Set de pixIdx

    for (let y = minY; y <= maxY; y++) {
        const crossings = [];

        for (let i = 0; i < n; i++) {
            const p1 = polygon[i];
            const p2 = polygon[(i + 1) % n];

            // El lado cruza la fila Y si un extremo está arriba y el otro abajo
            if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
                const x = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);
                crossings.push(x);
            }
        }

        crossings.sort((a, b) => a - b);

        // Rellenar entre pares de cruces [0,1], [2,3], ...
        for (let c = 0; c < crossings.length - 1; c += 2) {
            const xStart = Math.max(minX, Math.ceil(crossings[c]));
            const xEnd   = Math.min(maxX, Math.floor(crossings[c + 1]));

            for (let x = xStart; x <= xEnd; x++) {
                const pixIdx = y * width + x;
                const i      = pixIdx * 4;
                if (logicD[i + 3] === 0) continue; // agua, ignorar

                const key = (logicD[i] << 16) | (logicD[i + 1] << 8) | logicD[i + 2];
                const id  = colorToProvince[key];
                if (!id || provinceData[id]?.isOcean) continue;

                if (!provinceGroups.has(id)) provinceGroups.set(id, new Set());
                provinceGroups.get(id).add(pixIdx);
            }
        }
    }

    if (provinceGroups.size === 0) return false;

    let anyChange = false;
    for (const [provinceId, pixelSet] of provinceGroups) {
        // No crear provincia si el recorte abarca el 100% de la provincia
        if (pixelSet.size >= provincePixels[provinceId].length) continue;
        if (createProvinceFromPixelSet(pixelSet, provinceId, logicData)) anyChange = true;
    }

    return anyChange;
}

// =======================
// RECORTE EN AGUA — rodear islas por agua
//
// Cuando el path está todo sobre agua y es cerrado, busca qué provincias
// quedaron completamente rodeadas por el path y las convierte en nuevas provincias.
// =======================

function applyWaterEnclosure(segPath, logicData) {
    const width  = logicCanvas.width;
    const height = logicCanvas.height;

    // Solo válido si es un path cerrado
    const first = segPath[0];
    const last  = segPath[segPath.length - 1];
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    if (Math.sqrt(dx*dx + dy*dy) > 6) return false;
    if (segPath.length < 10) return false;

    // Máscara: 0=agua libre, 2=tierra o corte
    const mask   = new Uint8Array(width * height);
    const logicD = logicData.data;

    for (let i = 0; i < logicD.length; i += 4) {
        if (logicD[i + 3] > 0) mask[i / 4] = 2; // tierra = barrera
    }

    rasterizePath(segPath, mask, width, height, "closed");

    // Flood fill desde la esquina superior izquierda (exterior garantizado)
    // Solo se mueve por agua libre (valor 0)
    const exterior = new Uint8Array(width * height); // 0=no visitado, 1=visitado
    const queue    = [0];
    while (queue.length > 0) {
        const idx = queue.pop();
        if (exterior[idx] || mask[idx] !== 0) continue;
        exterior[idx] = 1;
        const x = idx % width;
        const y = Math.floor(idx / width);
        if (x > 0)          queue.push(idx - 1);
        if (x < width - 1)  queue.push(idx + 1);
        if (y > 0)          queue.push(idx - width);
        if (y < height - 1) queue.push(idx + width);
    }

    // Provincias cuyos píxeles no fueron alcanzados por el exterior → están adentro
    const provincesInside = new Set();
    for (const [key, id] of Object.entries(colorToProvince)) {
        if (!provincePixels[id] || provincePixels[id].length === 0) continue;
        if (provinceData[id]?.isOcean) continue;

        let hasExterior = false;
        for (let k = 0; k < provincePixels[id].length; k++) {
            if (exterior[provincePixels[id][k] / 4]) { hasExterior = true; break; }
        }
        if (!hasExterior) provincesInside.add(id);
    }

    if (provincesInside.size === 0) return false;

    let anyChange = false;
    for (const provinceId of provincesInside) {
        const newColor = generateUniqueColor(logicData, width, height);
        if (!newColor) continue;

        const newId  = bumpProvinceId();
        const newKey = (newColor[0] << 16) | (newColor[1] << 8) | newColor[2];

        colorToProvince[newKey] = newId;
        provinceData[newId] = {
            id: newId, colorKey: newKey, owner: null,
            name: `Provincia ${newId}`, paintColor: [...colorInicial], isWater: false,
        };

        provincePixels[newId] = [];
        for (let k = 0; k < provincePixels[provinceId].length; k++) {
            const i = provincePixels[provinceId][k];
            logicData.data[i]     = newColor[0];
            logicData.data[i + 1] = newColor[1];
            logicData.data[i + 2] = newColor[2];
            provincePixels[newId].push(i);
        }

        provincePixels[provinceId] = [];
        delete provinceData[provinceId];

        console.log(`Isla provincia ${provinceId} → nueva provincia ${newId}`);
        anyChange = true;
    }

    return anyChange;
}

// =======================
// CREAR NUEVA PROVINCIA A PARTIR DE UN SET DE PÍXELES
// Separa esos píxeles de su provincia original y los convierte en nueva provincia
// =======================

function createProvinceFromPixelSet(pixelSet, fromProvinceId, logicData) {
    const newColor = generateUniqueColor(logicData, logicCanvas.width, logicCanvas.height);
    if (!newColor) return false;

    const newId  = bumpProvinceId();
    const newKey = (newColor[0] << 16) | (newColor[1] << 8) | newColor[2];

    colorToProvince[newKey] = newId;
    provinceData[newId] = {
        id: newId, colorKey: newKey, owner: null,
        name: `Provincia ${newId}`, paintColor: [...colorInicial], isWater: false,
    };

    // oldPixelSet arranca con todos los píxeles de la provincia original.
    // Al final queda con los que NO pasaron a la nueva provincia.
    const oldPixelSet     = new Set(provincePixels[fromProvinceId]);
    const newPixelIndices = [];

    pixelSet.forEach(pixIdx => {
        const i = pixIdx * 4;
        logicData.data[i]     = newColor[0];
        logicData.data[i + 1] = newColor[1];
        logicData.data[i + 2] = newColor[2];
        newPixelIndices.push(i);
        oldPixelSet.delete(i);
    });

    provincePixels[newId]          = newPixelIndices;
    provincePixels[fromProvinceId] = Array.from(oldPixelSet);

    console.log(`Provincia ${fromProvinceId} cortada → nueva provincia ${newId} (${pixelSet.size} px)`);
    return true;
}

// =======================
// RASTERIZAR PATH — Bresenham entre cada par de puntos consecutivos
// Marca esos píxeles como 2 (barrera) en la máscara
// =======================

function rasterizePath(segPath, mask, width, height, cutType) {
    const points = [...segPath];
    if (cutType === "closed") points.push(segPath[0]); // cerrar el polígono

    for (let i = 0; i < points.length - 1; i++) {
        bresenham(
            Math.floor(points[i].x),   Math.floor(points[i].y),
            Math.floor(points[i+1].x), Math.floor(points[i+1].y),
            mask, width, height
        );
    }
}

function bresenham(x0, y0, x1, y1, mask, width, height) {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = (dx > dy ? dx : -dy) / 2;

    while (true) {
        if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
            mask[y0 * width + x0] = 2;
        }
        if (x0 === x1 && y0 === y1) break;
        const e2 = err;
        if (e2 > -dx) { err -= dy; x0 += sx; }
        if (e2 <  dy) { err += dx; y0 += sy; }
    }
}

// =======================
// FLOOD FILL ITERATIVO
// Expande desde seedIdx por todos los píxeles con valor 1 conectados
// Devuelve un Set con los índices de píxel encontrados
// =======================

function floodFill(mask, seedIdx, width, height) {
    const visited = new Set();
    const queue   = [seedIdx];

    while (queue.length > 0) {
        const idx = queue.pop();
        if (mask[idx] !== 1) continue; // solo pasa por 1s
        visited.add(idx);
        const x = idx % width;
        const y = Math.floor(idx / width);
        if (x > 0)          queue.push(idx - 1);
        if (x < width - 1)  queue.push(idx + 1);
        if (y > 0)          queue.push(idx - width);
        if (y < height - 1) queue.push(idx + width);
    }

    return visited;
}

function floodFillWithBorder(mask, seedIdx, width, height) {
    const visited = new Set();
    const queue   = [seedIdx];

    while (queue.length > 0) {
        const idx = queue.pop();
        if (visited.has(idx)) continue;
        if (mask[idx] === 0) continue; // agua, no pasar

        visited.add(idx);

        if (mask[idx] === 2) continue; // borde: incluir pero no expandir desde acá

        const x = idx % width;
        const y = Math.floor(idx / width);
        if (x > 0)          queue.push(idx - 1);
        if (x < width - 1)  queue.push(idx + 1);
        if (y > 0)          queue.push(idx - width);
        if (y < height - 1) queue.push(idx + width);
    }

    return visited;
}

// =======================
// GENERAR COLOR ÚNICO PARA NUEVA PROVINCIA
// =======================

function generateUniqueColor(logicData, width, height) {
    const usedColors = new Set();
    const data = logicData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        usedColors.add((data[i] << 16) | (data[i+1] << 8) | data[i+2]);
    }

    for (let attempt = 0; attempt < 1000; attempt++) {
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        const key = (r << 16) | (g << 8) | b;
        if (!usedColors.has(key)) return [r, g, b];
    }

    console.error("No se encontró color único disponible");
    return null;
}

// =======================
// OBTENER PROVINCIA EN UN PÍXEL DEL MAPA LÓGICO
// =======================

function getProvinceAtPixel(x, y, logicData) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= logicCanvas.width || yi >= logicCanvas.height) return null;

    const i = (yi * logicCanvas.width + xi) * 4;
    if (logicData.data[i + 3] === 0) return null;

    const key = (logicData.data[i] << 16) | (logicData.data[i+1] << 8) | logicData.data[i+2];
    return colorToProvince[key] ?? null;
}

// =======================
// COMMIT — aplicar cambios al estado y rerenderizar
// =======================

function commitChanges(logicData) {
    logicCtx.putImageData(logicData, 0, 0);
    state.baseCleanImageData = createBaseMap();
    state.baseImageData = new ImageData(
        new Uint8ClampedArray(state.baseCleanImageData.data),
        state.baseCleanImageData.width,
        state.baseCleanImageData.height
    );
    buildBorderCache();
    renderFromBase();
}