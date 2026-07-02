import { state, renderThrottle, brushColor, ZoomStep, MaxZoom, MinZoom}  from "./state.js";
import { renderFromBase, renderHighlight, fillContinuity }     from "./provinces.js";
import { renderLogicView, redrawPreview } from "./editor.js";
import { ToolStates, bucketMode } from "./ui.js";
import { rgbToHex, changeCountryColor, showProvinceAndCountryInfo } from "./countries.js";
import { logicCanvas } from "./main.js";


// camera es un objeto exportado para que provinces.js y otros puedan leerlo
export const camera = {
    x: 0, y: 0, zoom: 1,
};

let canvas_ref   = null;
let ctx_ref      = null;
let canvasRender_ref = null;
let ctxRender_ref    = null;
let logicCtx_ref     = null;
let colorToProvince_ref = null;
let provinceData_ref    = null;

// Llamado desde main.js después de que el canvas tiene dimensiones
export function initCamera(canvas, utils) {
    // importar referencias de main para no crear dependencia circular
    import("./main.js").then(m => {
        canvas_ref       = m.canvas;
        ctx_ref          = m.ctx;
        canvasRender_ref = m.canvasRender;
        ctxRender_ref    = m.ctxRender;
        logicCtx_ref     = m.logicCtx;
    });
    import("./state.js").then(m => {
        colorToProvince_ref = m.colorToProvince;
        provinceData_ref    = m.provinceData;
    });

    camera.center = { x: canvas.width / 2,  y: canvas.height / 2 };
    camera.offset = utils.scale({ x: canvas.width / 2, y: canvas.height / 2 }, -1);

    // ── Zoom ──
    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        const before = getMousePos(e, canvas);
        const dir    = Math.sign(e.deltaY);
        camera.zoom *= (1 - dir * ZoomStep);
        camera.zoom  = Math.max(MinZoom, Math.min(MaxZoom, camera.zoom));
        const after  = getMousePos(e, canvas);
        camera.x += before.x - after.x;
        camera.y += before.y - after.y;
        state.selectedProvince = null; // ← forzar que mousemove regenere el highlight

        if (state.wrapHorizontal) {
            const mapW = logicCtx_ref?.canvas.width ?? 0;
            if (mapW > 0) {
                camera.x = ((camera.x % mapW) + mapW) % mapW;
            }
        }

        if (ToolStates.editor.active) {
            renderLogicView();
            redrawPreview();
        } else if (state.pinnedProvince !== null) {
            renderFromBase();
            renderHighlight(state.pinnedProvince);
        } else {
            renderFromBase();
        }
        
    }, { passive: false });

    //moverselol
    const PAN_SPEED = 20; // píxeles por frame, ajustable

    const keys = {};

    document.addEventListener("keydown", e => {
        keys[e.key] = true;
    });

    document.addEventListener("keyup", e => {
        keys[e.key] = false;
    });

    function panLoop() {
        let moved = false;

        if (keys["w"] || keys["W"]) { camera.y -= PAN_SPEED / camera.zoom; moved = true; }
        if (keys["s"] || keys["S"]) { camera.y += PAN_SPEED / camera.zoom; moved = true; }
        if (keys["a"] || keys["A"]) { camera.x -= PAN_SPEED / camera.zoom; moved = true; }
        if (keys["d"] || keys["D"]) { camera.x += PAN_SPEED / camera.zoom; moved = true; }

        if (moved) {
            if (ToolStates.editor.active) {
                renderLogicView();
                redrawPreview();
            } else {
                renderFromBase();
            }
        }

        requestAnimationFrame(panLoop);
    }

    panLoop();

    // ── Click en provincia ──
    canvas.addEventListener("click", e => {

        if (!logicCtx_ref) return;
        const world = screenToWorld(e.offsetX, e.offsetY, canvas);
        const pixel = logicCtx_ref.getImageData(Math.floor(world.x), Math.floor(world.y), 1, 1).data;
        const key   = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
        const provinceId = colorToProvince_ref?.[key];
        if (!provinceId) return;

        if(ToolStates.inkweel.active)
        {
            const color = provinceData_ref[provinceId].paintColor;
            brushColor.rgb = [...color];

            const hex = '#' + color.map(v => v.toString(16).padStart(2, '0')).join('');
            const swatch = document.getElementById('brushColorDisplay');
            if (swatch) swatch.style.backgroundColor = hex;
            return;
        }

        if(ToolStates.bucket.active)
        {
            if (ToolStates.editor.active) {
                import("./editor.js").then(({ floodFill }) => {
                    floodFill(e.offsetX, e.offsetY);
                });
            }
            else if (bucketMode.FillCountry.active) {
                changeCountryColor(rgbToHex(provinceData_ref[provinceId].paintColor), rgbToHex(brushColor.rgb));
            }
            else if (bucketMode.FillContinuity.active) {
                fillContinuity(provinceId);
            }
            return;
        }

        if (ToolStates.select.active)
        {
            if (state.pinnedProvince === provinceId) {
                state.pinnedProvince = null;
                renderFromBase();
            } else {
                state.pinnedProvince = provinceId;
                showProvinceAndCountryInfo(provinceId);
                renderHighlight([provinceId]);
            }
            return;
        }
        if (!ToolStates.paint.active) return;

        import("./state.js").then(({ brushColor, waterColor, provinceData }) => {
            import("./provinces.js").then(({ arraysEqual, updateBaseMapColor, addBorders, renderFromBase }) => {
                import("./countries.js").then(({ rgbToHex, registerCountry, selectCountryColor, renderCountryList }) => {
                    state.selectedProvince = provinceId;

                    if (provinceData[provinceId]?.isOcean) return;

                    provinceData[provinceId].paintColor = [...brushColor.rgb];

                    if (arraysEqual(brushColor.rgb, waterColor.rgb)) {
                        provinceData[provinceId].isWater = true;
                    } else {
                        provinceData[provinceId].isWater = false;
                        const hex = rgbToHex(brushColor.rgb);
                        registerCountry(hex);
                        selectCountryColor(hex);
                        renderCountryList();
                    }
                    updateBaseMapColor(provinceId);
                    addBorders();
                    if (ToolStates.editor.active) {
                        renderLogicView();
                        redrawPreview();
                    } else {
                        renderFromBase();
                    }
                });
            });
        });
    });

    // ── Hover ──
    canvas.addEventListener("mousemove", e => {

        //if (ToolStates.select.active && state.pinnedProvince !== null) return;

        if (!logicCtx_ref) return;
        const now = performance.now();
        if (now - state.lastRenderTime < renderThrottle) return;
        state.lastRenderTime = now;

        const world = screenToWorld(e.offsetX, e.offsetY, canvas);
        const pixel = logicCtx_ref.getImageData(Math.floor(world.x), Math.floor(world.y), 1, 1).data;
        const key   = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
        const provinceId = colorToProvince_ref?.[key];

        if (!provinceId) { //                           si NO es una provincia válida
            if (state.selectedProvince !== null) { //   si había una provincia válida HLed antes
                state.selectedProvince = null; //       ahora lo limpia
                if (ToolStates.editor.active) {
                    renderLogicView();
                    redrawPreview();
                } else {
                    renderFromBase();
                    if (state.pinnedProvince !== null) {
                        renderHighlight([state.pinnedProvince]);
                    }
                }
            }
            return;
        }

        //if (provinceData[provinceId]?.isOcean) return;

        if (state.selectedProvince === provinceId) return; // no cambió, no rerenderizar

        state.selectedProvince = provinceId;

        const toHighlight = [provinceId];
        if (state.pinnedProvince && state.pinnedProvince !== provinceId) {
            toHighlight.push(state.pinnedProvince);
        }
        renderHighlight(toHighlight);
    });
}

export function screenToWorld(x, y, canvas) {
    let wx = camera.x + x / camera.zoom;
    let wy = camera.y + y / camera.zoom;
    
    if (state.wrapHorizontal) {
        const mapW = logicCtx_ref.canvas.width;
        wx = ((wx % mapW) + mapW) % mapW;
    }
    
    return { x: wx, y: wy };
}

function getMousePos(evt, canvas) {
    return screenToWorld(evt.offsetX, evt.offsetY, canvas);
}

/*
function fillContinuity(startProvinceId) {
    const targetColor = provinceData_ref[startProvinceId].paintColor;
    const newColor    = [...brushColor.rgb];
    
    if (arraysEqual(targetColor, newColor)) return;


    const width = logicCtx_ref.canvas.width;
    const logicData = logicCtx_ref.getImageData(0, 0, width, logicCtx_ref.canvas.height).data;

    const visited = new Set();
    const queue   = [startProvinceId];

    import("./provinces.js").then(({ updateBaseMapColor, addBorders, renderFromBase }) => {
    while (queue.length > 0) {
        const id = queue.pop();
        if (visited.has(id)) continue;
        if (!provinceData_ref[id]) continue;
        if (!arraysEqual(provinceData_ref[id].paintColor, targetColor)) continue;

        visited.add(id);
        provinceData_ref[id].paintColor = [...newColor];
        updateBaseMapColor(id);

        // buscar provincias vecinas — revisar píxeles de borde
        const pixels = provincePixels_ref[id];
        for (let k = 0; k < pixels.length; k++) {
            const i = pixels[k];
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);

            // chequear 4 vecinos
            const neighbors = [
                x > 0          ? i - 4         : -1,
                x < width - 1  ? i + 4         : -1,
                y > 0          ? i - width * 4 : -1,
                                 i + width * 4
            ];

            for (const ni of neighbors) {
                if (ni < 0) continue;
                const nKey = (logicData[ni] << 16) | (logicData[ni+1] << 8) | logicData[ni+2];
                const nId  = colorToProvince_ref[nKey];
                if (nId && !visited.has(nId)) queue.push(nId);
            }
        }
    }});

    addBorders();
    renderFromBase();
}*/