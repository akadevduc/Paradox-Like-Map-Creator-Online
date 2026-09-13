// =======================
// STATE — fuente de verdad compartida entre módulos
// Usar state.x = ... para mutar, nunca re-exportar como let
// =======================

export const state = {
    // render
    baseCleanImageData: null,
    highlightImageData: null,

    // interacción
    selectedProvince:  null,  // bajo el cursor (hover)
    pinnedProvince:    null,  // seleccionada con click, persiste
    lastRenderTime:   0,

    // setup
    loaded: false,

    // mapa fuente
    imgSrc:  "maps/map_empty.png",
    jsonSrc: "provinces.json",
    legacy:  false,
    wrapHorizontal: false,

    // Cache de contenido renderizado (solo se reconstruye si cambió)
    canvasDirty:    true,        // ¿necesita rebuild del canvasRender?
    cachedZoom:     1,
    cachedCamX:     0,
    cachedCamY:     0,
    _cachedScaledCanvas: null,

    // Píxeles por provincia: array plano Uint32 donde posición = índice de píxel,
    // valor = ID de provincia dueña (0 = océano). width*height*4 bytes,
    // vs la estructura Map<id, [Array<índices JS>]> que consumía 100-200 MB+.
    provincePixelIndices: null,  // Uint32Array(width*height), initialized en setup()
};

// =======================
// DATOS DE PROVINCIAS
// =======================
export const colorToProvince = {};   // colorKey  -> provinceId
export const provinceData    = {};   // id        -> { id, name, owner, paintColor, colorKey, isWater }
export let   nextProvinceId  = 1;
export function bumpProvinceId() { nextProvinceId++; return nextProvinceId - 1; }

// =======================
// COLORES
// =======================
export const brushColor    = { rgb: [255, 0, 0] };   // objeto para poder mutar desde cualquier módulo
export const colorResaltado = [40,  40,  40];          // intensidad del highlight
export const colorInicial   = [190, 190, 190];
export const waterColor     = { rgb: [129, 183, 218] };

// Listeners para sincronizar todos los inputs de color de agua
export const waterColorListeners = [];
export function setWaterColor(rgb) {
    waterColor.rgb = [rgb[0], rgb[1], rgb[2]];
    waterColorListeners.forEach(fn => { try { fn(); } catch (e) { console.warn("waterColorListener error:", e); } });
}

// =======================
// CONFIGURACIÓN
// =======================
export let provinceMapOpacity = 0.7;
export function setProvinceMapOpacity(v) { provinceMapOpacity = Math.max(0, Math.min(1, v)); }

export const opacityStep = 5;
export const renderThrottle = 16;

export let ZoomStep = 0.25;
export let MinZoom  = 0.05;
export let MaxZoom  = 50;

// =======================
// CAPAS DE AGUA
// =======================
export const waterLayers = [
    { name: "ríos",             src: "maps/water_rivers.png",         visible: true, img: null },
    { name: "lagos",            src: "maps/water_lakes.png",          visible: true, img: null },
    { name: "lagos históricos", src: "maps/water_historic_lakes.png", visible: true, img: null },
];
