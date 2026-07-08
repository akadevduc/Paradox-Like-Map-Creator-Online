const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");

// canvas lógico (no visible)
const logicCanvas = document.createElement("canvas");
const logicCtx = logicCanvas.getContext("2d");

const canvasRender = document.createElement("canvas");
const ctxRender = canvasRender.getContext("2d");

const waterCanvas = document.createElement("canvas");
const waterCtx = waterCanvas.getContext("2d");

const overlayCanvas = document.createElement("canvas");// Canvas donde se compositan todas las capas base
const overlayCtx = overlayCanvas.getContext("2d");

//elementos UI
const saveButton = document.getElementById("saveButton");
const clearButton = document.getElementById("clearButton");
const colorPicker = document.getElementById("brushColor");
const waterColorPicker = document.getElementById("waterColor");
const loadButton = document.getElementById("loadButton");
const saveIMGButton = document.getElementById("saveIMGButton");

// data
const colorToProvince = {};
const provinceData = {};
const provincePixels = {}; // índices de píxeles por provincia
let nextProvinceId = 1;
let selectedProvince = null;
let lastRenderTime = 0;
const renderThrottle = 16; // 60fps (algo lol)
let baseImageData = null; // Pre-renderizado base
let baseCleanImageData = null; // base SIN bordes, se mantiene para recomponer
let loaded = false;

let provinceMapOpacity = 0.7;
const opacityStep = 5;

// colores
let currentBrushColor = [255, 0, 0]; // rojo por defecto

let colorResaltado = [40, 40, 40]; // color OG - color resaltar

let colorInicial = [190, 190, 190]; // gris 

let waterColor = [129, 183, 218]; // color del agua por defecto

let highlightImageData = null;

// =======================
// CAPAS BASE (relieves, ríos, lagos, etc.)
// =======================
const overlayLayers = [
    { name: "relieves", src: "map_relieves.png",  opacity: 1.0, visible: true,  img: null }
];

const waterLayers = [
    { name: "ríos",             src: "water_rivers.png",         visible: true, img: null },
    { name: "lagos",            src: "water_lakes.png",          visible: true, img: null },
    { name: "lagos históricos", src: "water_historic_lakes.png", visible: true, img: null },
];

//=======================
// TODOS LOS addEventListeners
//=======================

// Slider de opacidad
document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('opacitySlider');
    const label  = document.getElementById('opacityLabel');
    if (!slider) return;

    slider.step  = opacityStep;
    slider.value = Math.round(provinceMapOpacity * 100);
    label.textContent = slider.value + '%';

    slider.addEventListener('input', e => {
        const pct = parseInt(e.target.value);
        label.textContent = pct + '%';
        setProvinceOpacity(pct / 100);
    });
});

saveIMGButton.addEventListener("click", e => {
    console.log("Exportando imagen...");
    exportFullMap();
});


const ChangeToGFMButton = document.getElementById("ChangeToGFMButton");
let legacy = false;

//valores iniciales, no confiar
let imgSrc  = "map_empty.png";
let jsonSrc = "provinces.json";


ChangeToGFMButton.addEventListener("click", async () => {
    legacy = !legacy;

    //lo que importa es cambiar estos 2
    imgSrc  = legacy ? "provinces_legacy.bmp" : "map_empty.png";
    jsonSrc = legacy ? "provinces_legacy.json" : "provinces.json";

    highlightImageData = null;  

    console.log(
        legacy
            ? "Cambiado a modo LEGACY"
            : "Cambiado a modo NORMAL"
    );

    // 1. Cargar imagen
    img.src = imgSrc;
    await img.decode(); // importante

    // 2. Resetear estado
    resetMapState();

    // 3. Redibujar imagen lógica
    logicCtx.clearRect(0, 0, logicCanvas.width, logicCanvas.height);
    overlayCanvas.width = img.width;
    overlayCanvas.height = img.height;
    rebuildOverlayCanvas();
    await addOverlayLayer(overlayLayers);
    await setup(jsonSrc);
});

function resetMapState() {
    Object.keys(colorToProvince).forEach(k => delete colorToProvince[k]);
    Object.keys(provinceData).forEach(k => delete provinceData[k]);
    Object.keys(provincePixels).forEach(k => delete provincePixels[k]);
    nextProvinceId = 1;
    selectedProvince = null;
}

colorPicker.addEventListener("input", e => {
    const hex = e.target.value;
    currentBrushColor = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
    ];
    // Actualizar swatch visual del botón
    const swatch = document.getElementById("brushColorDisplay");
    if (swatch) swatch.style.backgroundColor = hex;
});

waterColorPicker.addEventListener("input", e => {
    const hex = e.target.value;
    waterColor = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
    ];
    rebuildWaterLayer();   // ← agregá esta línea
    renderFromBase();      // ← y esta
});


loadButton.addEventListener("click", e => {
    const fileInput = document.getElementById("loadCustomMap");
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            applyProvinceData(data);

            baseCleanImageData = createBaseMap();
            addBorders();
            renderFromBase();

        } catch (err) {
            console.error("JSON inválido:", err);
        }
    };

    reader.readAsText(file);
});

// Carga una imagen de capa y la agrega a overlayLayers
function addOverlayLayer(name, src, opacity = 1.0) {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            overlayLayers.push({ name, src, opacity, visible: true, img: image });
            rebuildOverlayCanvas();
            renderFromBase();
            resolve();
        };
        image.onerror = () => {
            console.warn(`No se pudo cargar la capa: ${src}`);
            resolve();
        };
        image.src = src;
    });
}

// Recompone el canvas de capas base según visibilidad y opacidad
function rebuildOverlayCanvas() {
    if (overlayCanvas.width === 0) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.imageSmoothingEnabled = true;          // ← suavizado para escalar relieve
    overlayCtx.imageSmoothingQuality = "high";        // ← máxima calidad
    for (const layer of overlayLayers) {
        if (!layer.visible || !layer.img) continue;
        overlayCtx.globalAlpha = layer.opacity;
        overlayCtx.drawImage(layer.img, 0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    overlayCtx.globalAlpha = 1.0;
}

// imagen base
const img = new Image();
img.src = imgSrc;

img.onload = async () => {
    canvas.width = img.width;
    canvas.height = img.height;

    logicCanvas.width = img.width;
    logicCanvas.height = img.height;

    overlayCanvas.width = img.width;
    overlayCanvas.height = img.height;

    await setup(jsonSrc);
};

async function setup(jsonSrc) {

    // Cargar capas base antes del primer render
    await Promise.all(overlayLayers.map(layer => new Promise(resolve => {
        const image = new Image();
        image.onload = () => { layer.img = image; resolve(); };
        image.onerror = () => { console.warn("No se pudo cargar:", layer.src); resolve(); };
        image.src = layer.src;
    })));
    rebuildOverlayCanvas();

    logicCtx.drawImage(img, 0, 0);

    loaded = await loadMapProvinces(jsonSrc);

    buildProvinceData();

    await loadWaterLayers();

    baseCleanImageData = createBaseMap(); // Pre-renderizar al inicio
    baseImageData = new ImageData(new Uint8ClampedArray(baseCleanImageData.data), baseCleanImageData.width, baseCleanImageData.height);
    addBorders(); // crea baseImageData con bordes a partir de baseCleanImageData
    renderFromBase();

    // Inicializar lista de países desde datos cargados
    initCountriesFromProvinceData();
}

async function loadWaterLayers() {
    await Promise.all(waterLayers.map(layer => new Promise(resolve => {
        const image = new Image();
        image.onload = () => { layer.img = image; resolve(); };
        image.onerror = () => { console.warn("No se pudo cargar capa de agua:", layer.src); resolve(); };
        image.src = layer.src;
    })));
    waterCanvas.width  = overlayCanvas.width;
    waterCanvas.height = overlayCanvas.height;
    rebuildWaterLayer();
}

function rebuildWaterLayer() {
    const w = waterCanvas.width;
    const h = waterCanvas.height;
    if (!w || !h) return;

    // Canvas temporal para componer todas las capas de agua
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = "high";

    // Dibujar todas las capas visibles una sobre otra
    for (const layer of waterLayers) {
        if (!layer.visible || !layer.img) continue;
        tempCtx.drawImage(layer.img, 0, 0, w, h);
    }

    const imageData = tempCtx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 10) continue;
        data[i]     = waterColor[0];
        data[i + 1] = waterColor[1];
        data[i + 2] = waterColor[2];
    }

    waterCtx.clearRect(0, 0, w, h);
    waterCtx.putImageData(imageData, 0, 0);
}

function arraysEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// =======================
// CLICK
// =======================

function screenToWorld(x, y) {
    return {
        x: camera.x + x / camera.zoom,
        y: camera.y + y / camera.zoom
    };
}

canvas.addEventListener("click", e => {
    const world = screenToWorld(e.offsetX, e.offsetY);

    const pixel = logicCtx.getImageData(
        Math.floor(world.x),
        Math.floor(world.y),
        1, 1
    ).data;

    const key = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
    const provinceId = colorToProvince[key];

    if (!provinceId) return;

    selectedProvince = provinceId;
    console.log("Seleccionada:", provinceId);

    provinceData[provinceId].paintColor = [...currentBrushColor];
    
    if (arraysEqual(provinceData[provinceId].paintColor, waterColor)) {
        provinceData[provinceId].isWater = true;
    } else {
        provinceData[provinceId].isWater = false;
        // Registrar el color como país si no es agua
        const hex = rgbToHex(currentBrushColor);
        registerCountry(hex);
        selectCountryColor(hex);
        renderCountryList();
    }
    updateBaseMapColor(provinceId);
    addBorders();
    renderFromBase();

});

// =======================
// MOUSE ARRIBA (CON THROTTLE)
// =======================
canvas.addEventListener("mousemove", e => {
    
    const world = screenToWorld(e.offsetX, e.offsetY);

    const pixel = logicCtx.getImageData(
        Math.floor(world.x),
        Math.floor(world.y),
        1, 1
    ).data;

    const now = performance.now();
    if (now - lastRenderTime < renderThrottle) return;
    lastRenderTime = now;

    const key = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
    const provinceId = colorToProvince[key];

    if (!provinceId) {
        if (selectedProvince !== null) {
            selectedProvince = null;
            renderFromBase();
        }
        return;
    }

    if (selectedProvince !== provinceId) {
        selectedProvince = provinceId;
        renderHighlight(provinceId);
    }
});
/*
//zoom
const viewport = new Viewport(canvas);

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(1 / viewport.zoom, 1 / viewport.zoom);
    renderFromBase();
    ctx.restore();
    requestAnimationFrame(animate);
}
*/
    import * as utils from "./utils.js";

    function point(x, y) {
        return {x, y};
    }

    const camera = {
        x: 0,
        y: 0,
        zoom: 1,
        center: new point(canvas.width / 2, canvas.height / 2),
        offset: utils.scale(new point(canvas.width / 2, canvas.height / 2), -1)
    };

    

    function getMousePos(evt) {
        return point(
            camera.x + evt.offsetX / camera.zoom,
            camera.y + evt.offsetY / camera.zoom
        );
    }

    canvas.addEventListener("wheel", e => {
        e.preventDefault();

        const mouseBefore = getMousePos(e);

        const dir = Math.sign(e.deltaY);
        const step = 0.25;
        camera.zoom *= (1 - dir * step);
        camera.zoom = Math.max(0.1, Math.min(10, camera.zoom));

        const mouseAfter = getMousePos(e);

        // compensación de cámara
        camera.x += mouseBefore.x - mouseAfter.x;
        camera.y += mouseBefore.y - mouseAfter.y;

        renderZoom();
    });

    function renderZoom(imageData = baseImageData) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.imageSmoothingEnabled = false;

        canvasRender.width = imageData.width;
        canvasRender.height = imageData.height;

        ctxRender.putImageData(imageData, 0, 0);

        //ctx.save();
        //ctx.translate(camera.center.x, camera.center.y);

        ctx.drawImage(
            canvasRender,               //origen
            camera.x,                   //x
            camera.y,                   //y
            canvas.width / camera.zoom, //ancho
            canvas.height / camera.zoom,//alto
            0,                          //x: 0
            0,                          //y: 0
            canvas.width,               //ancho
            canvas.height               //alto
        );
    }

// =======================
// BUILD PROVINCES
// =======================
function buildProvinceData() {
    const imageData = logicCtx.getImageData( //lee todos los pixeles
        0, 0,
        logicCanvas.width,
        logicCanvas.height
    );
    const data = imageData.data; // pixeles pero en RGBA

    for (let i = 0; i < data.length; i += 4) {

        if (data[i + 3] === 0) continue; // píxel transparente, no es provincia

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        const key = (r << 16) | (g << 8) | b; // convierte a RGB binario pero lo trata como numero entero

        if (!colorToProvince[key]) { // para cada pixel del mismo color
            const newId = nextProvinceId++;
            colorToProvince[key] = newId;
            if (!loaded)
            {
                //crea una provincia
                colorToProvince[key] = newId; 
                provinceData[newId] = { 
                    id: newId,
                    colorKey: key,
                    owner: null, //REDO: el owner define el color
                    name: `Provincia ${newId}`,
                    paintColor: [...colorInicial], // color inicial
                    isWater: false
                };
            }
            provincePixels[newId] = []; // array que guarda los pixeles de por provincia
        }
        
        // Guarda el índice de píxel para esta provincia
        const id = colorToProvince[key];
        if (!provincePixels[id]) provincePixels[id] = [];
        provincePixels[id].push(i);
    }

    console.log("Provincias detectadas:", nextProvinceId - 1);
}

// =======================
// RENDER (PRE-RENDERIZADO)
// =======================
function createBaseMap() {
    const imageData = logicCtx.getImageData(
        0, 0,
        logicCanvas.width,
        logicCanvas.height
    );

    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const key = (r << 16) | (g << 8) | b;
        const provinceId = colorToProvince[key];

        if (!provinceId) {
            data[i + 3] = 0; // píxel fuera de provincias: transparente
            continue;
        }

        const color = provinceData[provinceId].paintColor;
        data[i]     = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        // Las provincias de agua son más transparentes para ver mejor el relieve
        data[i + 3] = provinceData[provinceId].isWater
            ? Math.round(provinceMapOpacity * 0.6 * 255)
            : Math.round(provinceMapOpacity * 255);
    }

    return imageData;
}

export function renderFromBase(imageData = state.baseImageData) {
    if (editorState.active) return;

    canvasRender.width  = imageData.width;
    canvasRender.height = imageData.height;

    // 1. Fondo o relieve
    if (overlayLayers.some(l => l.visible && l.img)) {
        ctxRender.drawImage(overlayCanvas, 0, 0);
    } else {
        ctxRender.fillStyle = "#ffffff";
        ctxRender.fillRect(0, 0, canvasRender.width, canvasRender.height);
    }

    // 2. Capa de agua
    if (waterLayers.some(l => l.visible && l.img)) {
        ctxRender.drawImage(waterCanvas, 0, 0);
    }

    // 3. Mapa de provincias (semitransparente)
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width  = imageData.width;
    tempCanvas.height = imageData.height;
    tempCanvas.getContext("2d").putImageData(imageData, 0, 0);
    ctxRender.drawImage(tempCanvas, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        canvasRender,
        camera.x, camera.y,
        canvas.width / camera.zoom,
        canvas.height / camera.zoom,
        0, 0,
        canvas.width, canvas.height
    );
    
}

function renderHighlight(id) {
    if (!highlightImageData) {
        const src = baseCleanImageData;
        const width = src.width;
        const height = src.height;
        highlightImageData = new ImageData(new Uint8ClampedArray(src.data), width, height);
    } else {
        highlightImageData.data.set(baseImageData.data);
    }

    const data = highlightImageData.data;
    const color = provinceData[id].paintColor;

    provincePixels[id].forEach(i => {
        data[i]     = color[0] - colorResaltado[0];
        data[i + 1] = color[1] - colorResaltado[1];
        data[i + 2] = color[2] - colorResaltado[2];
    });
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    renderFromBase(highlightImageData); 
}

function updateBaseMapColor(provinceId) {
    // Actualiza solo los píxeles de esta provincia en baseCleanImageData (NO en la versión con bordes)
    const data = baseCleanImageData.data;
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
    addBorders();
}

function addBorders(colorBorde = [20, 20, 20]) { //124 
    const src = baseCleanImageData;
    const width = src.width;
    const height = src.height;
    const imageData = new ImageData(new Uint8ClampedArray(src.data), width, height);
    const data = imageData.data;
    
    const borderPixels = [];

    for (let i = 0; i < data.length; i += 4) {
        const pixelIndex = i / 4;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);

        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) continue;
        
        if (data[i] === colorBorde[0] && data[i + 1] === colorBorde[1] && data[i + 2] === colorBorde[2]) continue; //cambiar esto aumenta el grosor
       
        const derechaIdx = i + 4; 
        const izquierdaIdx = i - 4;
        const arribaIdx = i - width * 4;
        const abajoIdx = i + width * 4;
        //solo abajo y derecha, bordes interiores

        const colorActualR = data[i];
        const colorActualG = data[i + 1];
        const colorActualB = data[i + 2];

        const colorDerechaR = data[derechaIdx]
        const colorDerechaG = data[derechaIdx + 1];
        const colorDerechaB = data[derechaIdx + 2];

        const colorIzquierdaR = data[izquierdaIdx];
        const colorIzquierdaG = data[izquierdaIdx + 1];
        const colorIzquierdaB = data[izquierdaIdx + 2];

        const colorArribaR = data[arribaIdx];
        const colorArribaG = data[arribaIdx + 1];
        const colorArribaB = data[arribaIdx + 2];

        const colorAbajoR = data[abajoIdx];
        const colorAbajoG = data[abajoIdx + 1];
        const colorAbajoB = data[abajoIdx + 2];
    

        if (colorActualR !== colorDerechaR || colorActualG !== colorDerechaG || colorActualB !== colorDerechaB ||
            colorActualR !== colorAbajoR  || colorActualG !== colorAbajoG  || colorActualB !== colorAbajoB ||
            colorActualR !== colorIzquierdaR || colorActualG !== colorIzquierdaG || colorActualB !== colorIzquierdaB ||
            colorActualR !== colorArribaR  || colorActualG !== colorArribaG  || colorActualB !== colorArribaB) {
            borderPixels.push(i);
        }
    }
    // Dibuja los bordes en el color especificado
    borderPixels.forEach(i => {
        data[i]     = Math.min(data[i] - colorBorde[0], 255);
        data[i + 1] = Math.min(data[i + 1] - colorBorde[1], 255);
        data[i + 2] = Math.min(data[i + 2] - colorBorde[2], 255);
    });
        // Reemplaza la imagen base usada para render (con bordes)
    baseImageData = imageData;
    
}

function updateProvinceBorders(id, colorBorde = [20, 20, 20]) { //124 
    const src = baseCleanImageData;
    const width = src.width;
    const height = src.height;
    const imageData = new ImageData(new Uint8ClampedArray(src.data), width, height);
    const data = imageData.data;
    
    const borderPixels = [];

    provincePixels[id].forEach(i => { 

        const pixelIndex = i / 4;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);

        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) return;

        //evita pintar sobre bordes existentes
        if (data[i] === colorBorde[0] && data[i + 1] === colorBorde[1] && data[i + 2] === colorBorde[2]) return; 
       
        const derechaIdx = i + 4; 
        const izquierdaIdx = i - 4;
        const arribaIdx = i - width * 4;
        const abajoIdx = i + width * 4;

        const colorActualR = data[i];
        const colorActualG = data[i + 1];
        const colorActualB = data[i + 2];

        const colorDerechaR = data[derechaIdx]
        const colorDerechaG = data[derechaIdx + 1];
        const colorDerechaB = data[derechaIdx + 2];

        const colorIzquierdaR = data[izquierdaIdx];
        const colorIzquierdaG = data[izquierdaIdx + 1];
        const colorIzquierdaB = data[izquierdaIdx + 2];

        const colorArribaR = data[arribaIdx];
        const colorArribaG = data[arribaIdx + 1];
        const colorArribaB = data[arribaIdx + 2];

        const colorAbajoR = data[abajoIdx];
        const colorAbajoG = data[abajoIdx + 1];
        const colorAbajoB = data[abajoIdx + 2];

        if (colorActualR !== colorDerechaR || colorActualG !== colorDerechaG || colorActualB !== colorDerechaB ||
            colorActualR !== colorAbajoR  || colorActualG !== colorAbajoG  || colorActualB !== colorAbajoB ||
            colorActualR !== colorIzquierdaR || colorActualG !== colorIzquierdaG || colorActualB !== colorIzquierdaB ||
            colorActualR !== colorArribaR  || colorActualG !== colorArribaG  || colorActualB !== colorArribaB) {
            borderPixels.push(i);
        }
    })
    // Dibuja los bordes en el color especificado
    borderPixels.forEach(i => {
        data[i]     = Math.min(data[i] - colorBorde[0], 255);
        data[i + 1] = Math.min(data[i + 1] - colorBorde[1], 255);
        data[i + 2] = Math.min(data[i + 2] - colorBorde[2], 255);
    });
        // Reemplaza la imagen base usada para render (con bordes)
    baseImageData = imageData;
    
}

function saveMapProvinces(){
    const obj = lightSaveObject();
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `provinces.json`;
    //a.download = `map_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log("Mapa guardado");
}

function lightSaveObject(){
    const provinces = {};

    Object.keys(provinceData).forEach(id => {
        const pd = provinceData[id];
        provinces[id] = {
            id: pd.id,
            name: pd.name,
            owner: pd.owner,
            isWater: pd.isWater,
            paintColor: pd.paintColor,  // [R, G, B]
            colorKey: pd.colorKey       // key binario para reconstruir colorToProvince
            };
    });

    return {
        meta: {
            width: logicCanvas.width,
            height: logicCanvas.height,
            imgSrc: img.src,
            timestamp: Date.now()
        },
        provinces  // id -> {name, owner, paintColor, colorKey}
    };
}

function clearMapProvinces(){
    // Poner todas las provincias al color inicial (excepto agua)
    Object.keys(provinceData).forEach(id => {
        // Si es agua, NO tocar
        if (provinceData[id].isWater) return;
        
        // Resetea el color al inicial
        provinceData[id].paintColor = [...colorInicial];
    });
    
    // Recalcular la base limpia, bordes y render
    baseCleanImageData = createBaseMap();
    addBorders();
    renderFromBase();
}

// Al cargar la página, intenta leer provinces.json
async function loadMapProvinces(file = "provinces.json" ) { //provinces_legacy.json para legacy
    try {
        const response = await fetch(file);
        if (!response.ok) {
            console.log("provinces.json no encontrado, iniciando vacío");
            return false;
        }
        const data = await response.json();
        
        // Restaura las provincias desde el JSON
        Object.keys(data.provinces).forEach(id => {
            const pd = data.provinces[id];
            provinceData[id] = {
                id: parseInt(id),
                name: pd.name,
                owner: pd.owner,
                paintColor: pd.paintColor,
                colorKey: pd.colorKey,
                isWater: pd.isWater ?? false
            };
            colorToProvince[pd.colorKey] = parseInt(id);
            nextProvinceId = Math.max(nextProvinceId, parseInt(id) + 1);
        });
        
        console.log("Mapa cargado desde provinces.json");
        return true;
    } catch (err) {
        console.error("Error cargando provinces.json:", err);
        return false;
    }
}

saveButton.addEventListener("click", e => {
    console.log("Guardando imagen...");
    saveMapProvinces();
});
clearButton.addEventListener("click", e => {
    console.log("Limpiando mapa...");
    clearMapProvinces();
});

function applyProvinceData (data)
{
    Object.keys(data.provinces).forEach(id => {
        const pd = data.provinces[id];
        provinceData[id] = {
            id: parseInt(id),
            name: pd.name,
            owner: pd.owner,
            paintColor: pd.paintColor,
            colorKey: pd.colorKey,
            isWater: pd.isWater ?? false
        };
        colorToProvince[pd.colorKey] = parseInt(id);
        nextProvinceId = Math.max(nextProvinceId, parseInt(id) + 1);
    });

    console.log("Mapa cargado");
}

function exportFullMap(filename = "map.png") {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = baseImageData.width;
    exportCanvas.height = baseImageData.height;

    const exportCtx = exportCanvas.getContext("2d");
    exportCtx.putImageData(baseImageData, 0, 0);

    const url = exportCanvas.toDataURL("image/png");

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
}

document.querySelector("#loadCustomMap").onchange = function() {
    const fileName = this.files[0]?.name;
    const label = document.querySelector("label[for=loadCustomMap]");
    label.innerText = fileName ?? "Browse Files";
};

// =======================
// API DE CAPAS BASE
// Uso desde consola o botones de UI:
//   addOverlayLayer("relieves", "relief.png", 1.0)
//   setLayerOpacity("relieves", 0.8)
//   setLayerVisibility("relieves", false)
//   setProvinceOpacity(0.7)
// =======================

function setLayerOpacity(name, opacity) {
    const layer = overlayLayers.find(l => l.name === name);
    if (!layer) return console.warn("Capa no encontrada:", name);
    layer.opacity = Math.max(0, Math.min(1, opacity));
    rebuildOverlayCanvas();
    renderFromBase();
}

function setLayerVisibility(name, visible) {
    const layer = overlayLayers.find(l => l.name === name);
    if (!layer) return console.warn("Capa no encontrada:", name);
    layer.visible = visible;
    rebuildOverlayCanvas();
    renderFromBase();
}

function setProvinceOpacity(opacity) {
    provinceMapOpacity = Math.max(0, Math.min(1, opacity));
    baseCleanImageData = createBaseMap();
    addBorders();
    renderFromBase();
}

function removeOverlayLayer(name) {
    const idx = overlayLayers.findIndex(l => l.name === name);
    if (idx === -1) return console.warn("Capa no encontrada:", name);
    overlayLayers.splice(idx, 1);
    rebuildOverlayCanvas();
    renderFromBase();
}
// =======================
// SISTEMA DE PAÍSES 
// =======================
const countries = new Map(); // hex -> { name, color:[r,g,b] }

function rgbToHex(rgb) {
    return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
    return [
        parseInt(hex.slice(1,3), 16),
        parseInt(hex.slice(3,5), 16),
        parseInt(hex.slice(5,7), 16)
    ];
}

function registerCountry(hex, name = null) {
    if (!countries.has(hex)) {
        countries.set(hex, {
            name: name ?? `País ${countries.size + 1}`,
            color: hexToRgb(hex)
        });
    } else if (name) {
        countries.get(hex).name = name;
    }
}

// Seleccionar color de la lista como pincel activo
function selectCountryColor(hex) {
    currentBrushColor = hexToRgb(hex);
    const swatch = document.getElementById('brushColorDisplay');
    if (swatch) swatch.style.backgroundColor = hex;
    document.querySelectorAll('.country-item').forEach(el => {
        el.classList.toggle('country-item--active', el.dataset.hex === hex);
    });
}

// Cambiar color de un país y repintar todas sus provincias
function changeCountryColor(oldHex, newHex) {
    if (oldHex === newHex || !countries.has(oldHex)) return;
    const country = countries.get(oldHex);
    const newRgb = hexToRgb(newHex);

    Object.values(provinceData).forEach(pd => {
        if (rgbToHex(pd.paintColor) === oldHex) {
            pd.paintColor = [...newRgb];
            updateBaseMapColor(pd.id);
        }
    });

    countries.delete(oldHex);
    country.color = newRgb;
    countries.set(newHex, country);

    if (rgbToHex(currentBrushColor) === oldHex) {
        selectCountryColor(newHex);
    }

    addBorders();
    renderFromBase();
    renderCountryList();
}

function renderCountryList() {
    const list = document.getElementById('countryList');
    if (!list) return;
    list.innerHTML = '';

    if (countries.size === 0) {
        list.innerHTML = '<li class="country-empty">Todavía no hay países. Pintá una provincia para empezar.</li>';
        return;
    }

    const activeHex = rgbToHex(currentBrushColor);

    countries.forEach((country, hex) => {
        const isSelected = hex === activeHex;
        const li = document.createElement('li');
        li.className = 'country-item' + (isSelected ? ' country-item--active' : '');
        li.dataset.hex = hex;

        li.innerHTML =
            '<button class="country-swatch" style="background:' + hex + '" title="Seleccionar como pincel"></button>' +
            '<input  class="country-name" type="text" value="' + country.name + '" spellcheck="false" />' +
            '<span   class="country-hex">' + hex.toUpperCase() + '</span>' +
            '<input  class="country-color-picker" type="color" value="' + hex + '" title="Cambiar color del país" />';

        // Clic en swatch → seleccionar como pincel
        li.querySelector('.country-swatch').addEventListener('click', () => {
            selectCountryColor(hex);
        });

        // Editar nombre
        li.querySelector('.country-name').addEventListener('change', e => {
            const newName = e.target.value.trim();
            if (newName) countries.get(hex).name = newName;
        });

        // Cambiar color: preview mientras arrastrás
        li.querySelector('.country-color-picker').addEventListener('input', e => {
            const newHex = e.target.value;
            li.querySelector('.country-swatch').style.background = newHex;
            li.querySelector('.country-hex').textContent = newHex.toUpperCase();
        });

        // Cambiar color: confirmar al soltar → repinta el mapa
        li.querySelector('.country-color-picker').addEventListener('change', e => {
            changeCountryColor(hex, e.target.value);
        });

        list.appendChild(li);
    });
}

// Reconstruir países desde provinceData (al cargar un JSON guardado)
function initCountriesFromProvinceData() {
    countries.clear();
    const colorInicialHex = rgbToHex(colorInicial);
    Object.values(provinceData).forEach(pd => {
        if (pd.isWater) return;
        const hex = rgbToHex(pd.paintColor);
        if (hex === colorInicialHex) return; // color neutro, no es un país
        registerCountry(hex, pd.owner ?? null);
    });
    renderCountryList();
}

// Botón "+ Agregar" en el panel
document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('addCountryBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const hex = document.getElementById('brushColor').value;
            registerCountry(hex);
            selectCountryColor(hex);
            renderCountryList();
        });
    }
    // Inicializar swatch del botón pincel
    const swatch = document.getElementById('brushColorDisplay');
    if (swatch) swatch.style.backgroundColor = '#ff0000';
});

