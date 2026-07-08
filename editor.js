import { canvas, ctx, logicCanvas, logicCtx }  from "./main.js";
import { state, colorToProvince, provinceData,
         provincePixels, bumpProvinceId,
         colorInicial }                        from "./state.js";
import { camera }                              from "./camera.js";
import { buildBorderCache, createBaseMap,
         renderFromBase }                      from "./provinces.js";
import { ToolStates }                         from "./ui.js";
 
// =======================
// MODO EDICIÓN DEL MAPA BASE
//
// Flujo:
//   1. Usuario activa el modo con el botón "Editar Mapa"
//   2. Se muestra el logicCanvas crudo (colores únicos por provincia)
//   3. El usuario dibuja píxeles sobre un overlay con color de preview
//   4. Al confirmar, los píxeles del overlay se escriben en logicCanvas
//      con un color único nuevo y se registra como nueva provincia
//   5. Al cancelar, se descarta el overlay sin tocar nada
// =======================

const previewCanvas = document.createElement("canvas");
const previewCtx = previewCanvas.getContext("2d");
const previewColor = "rgba(128, 128, 128, 0.5)";


let isDrawing = false;
let aboutConfirm = false;

let drawnPixels = new Set();

//inicio

export function initMapEditor() {
    // Solo agregar al DOM si no está ya
    if (!document.getElementById("previewCanvas")) {
        canvas.parentElement.appendChild(previewCanvas);
    }

  //previewCanvas.id     = "previewCanvas";
    previewCanvas.width  = canvas.width;
    previewCanvas.height = canvas.height;
    previewCanvas.style.position      = "absolute";
    previewCanvas.style.left          = canvas.offsetLeft + "px";
    previewCanvas.style.top           = canvas.offsetTop + "px";
    previewCanvas.style.pointerEvents = "none";
    previewCanvas.style.display       = "none";
    canvas.parentElement.appendChild(previewCanvas);

    canvas.addEventListener("mousedown",  onmousedown);
    canvas.addEventListener("mousemove",  onmousemove);
    canvas.addEventListener("mouseup",    onmouseup);
    canvas.addEventListener("mouseleave", onmouseup);
}

export function toggleMapEditor() {
    console.log("toggleMapEditor llamado, ToolStates.editor.active antes:", ToolStates.editor.active);
    canvas.style.cursor = ToolStates.editor.active ? "crosshair" : "default";

    if(ToolStates.editor.active){
        previewCanvas.style.display = "block";
        renderLogicView();
    }
    else{
        previewCanvas.style.display = "none";
        clearPreview();
        renderFromBase();
    }
}

// =======================
// RENDER DEL MAPA LÓGICO CRUDO
//
// Muestra los colores únicos del logicCanvas directamente,
// sin los colores de pintura. Así el usuario ve las formas
// exactas de cada provincia mientras edita.
// =======================

export function renderLogicView() {
    ctx.fillStyle = "#0e0e18";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        logicCanvas,
        camera.x, camera.y,
        canvas.width  / camera.zoom, 
        canvas.height / camera.zoom,
        0, 0,
        canvas.width, canvas.height
    );
}

// =======================
// EVENTOS DEL MOUSE
// =======================

function onmousedown(e) {
    console.log("mousedown editor, ToolStates.editor.active:", ToolStates.editor.active);
    if (!ToolStates.editor.active) return;
    if (ToolStates.bucket.active) return; 
    isDrawing = true;
    drawPixel(e.offsetX, e.offsetY);
}

function onmousemove(e) {
    if (!ToolStates.editor.active || !isDrawing) return;
    if (ToolStates.bucket.active) return; 
    drawPixel(e.offsetX, e.offsetY);
}

function onmouseup(e) {
    if (!ToolStates.editor.active) return;
    isDrawing = false;
}

// =======================
// DIBUJAR UN PÍXEL
//
// Convierte pantalla → mundo, guarda en drawnPixels,
// y pinta en el previewCanvas escalado al zoom actual.
// =======================
 
function drawPixel(sx, sy){
    const world = screenToWorld(sx, sy);

    if(world.x < 0 || world.y < 0 || 
       world.x >= logicCanvas.width || 
       world.y >= logicCanvas.height) return;

    const key = `${world.x},${world.y}`;
    if(drawnPixels.has(key)) return; // evitar dibujar el mismo píxel varias veces

    drawnPixels.add(key);
    aboutConfirm = true;

    const x0 = Math.floor((world.x     - camera.x) * camera.zoom);
    const y0 = Math.floor((world.y     - camera.y) * camera.zoom);
    const x1 = Math.floor((world.x + 1 - camera.x) * camera.zoom);
    const y1 = Math.floor((world.y + 1 - camera.y) * camera.zoom);
    previewCtx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));

    previewCtx.fillStyle = previewColor;
}

// =======================
// BALDE — flood fill sobre el logicCanvas
//
// Rellena todos los píxeles conectados del mismo color
// desde el punto clickeado, respetando los bordes de
// provincias existentes como paredes naturales.
// =======================

export function floodFill(sx, sy) { 
    if (!ToolStates.editor.active) return;

    const world = screenToWorld(sx, sy);
    if(world.x < 0 || world.y < 0 || 
       world.x >= logicCanvas.width || 
       world.y >= logicCanvas.height) return;
    
    const width    = logicCanvas.width;
    const height   = logicCanvas.height;
    const imageData = logicCtx.getImageData(0, 0, width, height);//<---
    const data   = imageData.data;

    const SENTINEL_R = 1, SENTINEL_G = 1, SENTINEL_B = 1;
    for (const key of drawnPixels) {
        const [x, y] = key.split(",").map(Number);
        const i = (y * width + x) * 4;
        data[i]     = SENTINEL_R;
        data[i + 1] = SENTINEL_G;
        data[i + 2] = SENTINEL_B;
        data[i + 3] = 255;
    }

    const startIdx = (Math.floor(world.y) * width + Math.floor(world.x)) * 4;
    const targetR  = data[startIdx];
    const targetG  = data[startIdx + 1];
    const targetB  = data[startIdx + 2];
    const targetA  = data[startIdx + 3];

    if (targetR === SENTINEL_R && targetG === SENTINEL_G && targetB === SENTINEL_B) return;

    const queue   = [[Math.floor(world.x), Math.floor(world.y)]];
    const visited = new Set();

    while (queue.length > 0) {
        const [x, y] = queue.pop();
        const key    = `${x},${y}`;

        if (visited.has(key)) continue;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;

        const i = (y * width + x) * 4;
        if (data[i]     !== targetR || data[i + 1] !== targetG ||
            data[i + 2] !== targetB || data[i + 3] !== targetA) continue;

        visited.add(key);
        drawnPixels.add(key);
        aboutConfirm = true;

        queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    redrawPreview();
}

// =======================
// REDIBUJAR PREVIEW COMPLETO
//
// Se usa después del balde porque agrega muchos píxeles de golpe.
// El pincel agrega de a uno, así que no necesita esto.
// =======================

export function redrawPreview(){
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    previewCtx.fillStyle = previewColor;
    
    for(const key of drawnPixels){
        const [wx, wy] = key.split(",").map(Number);

        const x0 = Math.floor((wx     - camera.x) * camera.zoom);
        const y0 = Math.floor((wy     - camera.y) * camera.zoom);
        const x1 = Math.floor((wx + 1 - camera.x) * camera.zoom);
        const y1 = Math.floor((wy + 1 - camera.y) * camera.zoom);

        previewCtx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
}

// =======================
// CONFIRMAR
//
// 1. Genera un color único para la nueva provincia
// 2. Escribe los píxeles en logicCanvas
// 3. Si un píxel pertenecía a otra provincia, se lo quita (modo reemplazar)
// 4. Registra la nueva provincia y regenera todo
// =======================

export function confirmEdit() {
    if (!aboutConfirm || drawnPixels.size === 0) return;

    const width     = logicCanvas.width;
    const logicImageData = logicCtx.getImageData(0, 0, width, logicCanvas.height);
    const data = logicImageData.data;

    const newColor = generateUniqueColor(data);
    if (!newColor) {
        alert("No quedan colores disponibles para nuevas provincias. Osea existen 256^3 = 16.777.216 provincias, así que... buena suerte con eso.");
        return;
    }

    const newId = bumpProvinceId();
    const newKey = (newColor[0] << 16) | (newColor[1] << 8) | newColor[2];

    colorToProvince[newKey] = newId;
    provinceData[newId] = {
        id: newId,
        colorKey: newKey,
        owner: null,
        name: `Provincia ${newId}`,
        paintColor: [...colorInicial],
        isWater: false,
    };
    provincePixels[newId] = [];

    // Antes del loop — convertir provincias afectadas a Set para O(1)
    const affectedSets = new Map();

    for (const key of drawnPixels) {
        const [x, y] = key.split(",").map(Number);
        const i      = (y * width + x) * 4;

        const oldColorKey = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        const oldId       = colorToProvince[oldColorKey];

        if (oldId && oldId !== newId && provincePixels[oldId]) {
            // Convertir a Set la primera vez que encontramos esta provincia
            if (!affectedSets.has(oldId)) {
                affectedSets.set(oldId, new Set(provincePixels[oldId]));
            }
            affectedSets.get(oldId).delete(i);
        }

        data[i]     = newColor[0];
        data[i + 1] = newColor[1];
        data[i + 2] = newColor[2];
        data[i + 3] = 255;
        provincePixels[newId].push(i);
    }

    // Reconvertir Sets a arrays
    for (const [id, set] of affectedSets) {
        provincePixels[id] = Array.from(set);
    }

    for(const key of drawnPixels){
        const [x, y] = key.split(",").map(Number);
        const i      = (y * width + x) * 4;

        const oldColorKey = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        const oldId       = colorToProvince[oldColorKey];
        if (oldId && oldId !== newId && provincePixels[oldId]) {
            provincePixels[oldId] = provincePixels[oldId].filter(idx => idx !== i);
        }

        data[i]     = newColor[0];
        data[i + 1] = newColor[1];
        data[i + 2] = newColor[2];
        data[i + 3] = 255;

        provincePixels[newId].push(i);
    }

    logicCtx.putImageData(logicImageData, 0, 0);

    state.baseCleanImageData = createBaseMap();
    state.baseImageData = new ImageData(
        new Uint8ClampedArray(state.baseCleanImageData.data),
        state.baseCleanImageData.width,
        state.baseCleanImageData.height
    );
    buildBorderCache();
 
    console.log(`Nueva provincia ${newId} creada con ${drawnPixels.size} px`);
 
    clearPreview();
    renderLogicView(); // mantener vista lógica para seguir editando
}

// =======================
// CANCELAR
// =======================
 
export function cancelEdit() {
    clearPreview();
    if (ToolStates.editor.active) renderLogicView();
}
 
function clearPreview() {
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    drawnPixels.clear();
    aboutConfirm = false;
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
 
// =======================
// GENERAR COLOR ÚNICO
// =======================
 
function generateUniqueColor(data) {
    const usedColors = new Set();
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        usedColors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    for (let attempt = 0; attempt < 1000; attempt++) {
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        const key = (r << 16) | (g << 8) | b;
        if (!usedColors.has(key)) return [r, g, b];
    }
    return null;
}