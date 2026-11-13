// =======================
// STATE — fuente de verdad compartida entre módulos
// Usar state.x = ... para mutar, nunca re-exportar como let
// =======================

class Map_state {
    constructor({ id, name, imgSrc, jsonSrc}) {
        this.id = id;
        this.name = name;
        this.imgSrc = imgSrc;
        this.jsonSrc = jsonSrc;
    }
}

export class Province {
    constructor({
        id,
        colorKey,
        name       = `Provincia ${id}`,
        owner      = null,
        controller    = null,
        // propiedades de EU4 (mismos nombres que el save)
        tradeGoods     = null,
        baseTax        = 0,
        baseProduction = 0,
        baseManpower   = 0,
        religion       = null,
        culture        = null,
        //siguen las cosas mías
        isWater    = false,
        paintColor = null,
    }) {
        this.id         = id;
        this.colorKey   = colorKey;
        this.name       = name;
        this.owner      = owner;
        this.controller = controller;
        this.tradeGoods     = tradeGoods;
        this.baseTax        = baseTax;
        this.baseProduction = baseProduction;
        this.baseManpower   = baseManpower;
        this.religion       = religion;
        this.culture        = culture;
        this.isWater    = isWater;
        // si no te pasan color: agua -> waterColor, el resto -> colorInicial
        this.paintColor = [...(paintColor ?? (isWater ? waterColor.rgb : colorInicial))];
    }

    get development() {
        return this.baseTax + this.baseProduction + this.baseManpower;
    }

    // La provincia especial del océano (píxeles transparentes) yo:???
    static ocean(id, colorKey) {
        return new Province({ id, colorKey, name: "Océano", isWater: true });
    }

    // Para datos que vienen de un JSON o save: respeta lo que haya y completa lo que falte
    static fromData(id, data) {
        return new Province({ ...data, id: parseInt(id) });
    }
}

export const state = {
    // render
    baseCleanImageData: null,
    highlightImageData: null,
    wrapHorizontal: false,

    // interacción
    selectedProvince:  null,  // bajo el cursor (hover)
    pinnedProvince:    null,  // seleccionada con click, persiste
    lastRenderTime:   0,

    // setup
    loaded: false,

    // mapa fuente
    stock_map: new Map_state({
        id: "stock",
        name: "Stock",
        imgSrc:  "maps/map_empty.png",
        jsonSrc: "maps_data/stock_provinces.json"
    }),

    // legacy mode (Victoria 2 GFM)
    gfm_map: new Map_state({
        id: "GFM",
        name: "Victoria 2 GFM",
        imgSrc:  "maps/GFM_provinces.bmp",
        jsonSrc: "maps_data/gfm_provinces.json"
    }),

    eu4_map: new Map_state({
        id: "EU4",
        name: "Europa Universalis 4",
        imgSrc:  "maps/EU4_provinces.bmp",
        jsonSrc: "maps_data/eu4_provinces.json"
    }),

    activeMapId: "stock", //por defecto lol
    get defaultMap() { return this.stock_map; },

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
// estructura: [rojo, verde, azul] (0-255)
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
export let provinceMapOpacity = 1;
export function setProvinceMapOpacity(v) { provinceMapOpacity = Math.max(0, Math.min(1, v)); }

export const opacityStep = 5;
export const renderThrottle = 16;

export let ZoomStep = 0.25;
export let MinZoom  = 0.05;
export let MaxZoom  = 50;

// =======================
// CAPAS DE AGUA
// =======================
export const waterLayers = [ //debería ponerlo dentro de la clase Map_state pero como no lo uso mas como que no da lol
    { name: "ríos",             src: "maps/water_rivers.png",         visible: true, img: null },
    { name: "lagos",            src: "maps/water_lakes.png",          visible: true, img: null },
    { name: "lagos históricos", src: "maps/water_historic_lakes.png", visible: true, img: null },
];
