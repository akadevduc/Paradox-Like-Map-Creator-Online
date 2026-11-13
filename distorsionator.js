import { desenrollarCono, proyectarPunto, ajustarEscala } from "./distorsionator-geometry.js";
import { camera, screenToWorld } from "./camera.js";
import { state } from "./state.js";
import { logicCanvas } from "./main.js";

const panel = document.getElementById("panel-ajuste");
const titulo = document.getElementById("panel-titulo");
const nombre = document.getElementById("panel-nombre");
const CLAVE_POS = "panelAjuste:pos";

let imagenActual = null;
let imagenSeleccionada = "ref-1";
let arrastre = null;

function moverA(x, y) {
    const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - panel.offsetHeight);

    panel.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
    panel.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
}

function guardarPos() {
    try {
        localStorage.setItem(CLAVE_POS, JSON.stringify({
            x: parseFloat(panel.style.left),
            y: parseFloat(panel.style.top)
        }));
    } catch (error) {
        console.warn("No se pudo guardar la posición del panel.", error);
    }
}

function restaurarPos() {
    let pos = null;

    try {
        pos = JSON.parse(localStorage.getItem(CLAVE_POS));
    } catch {}

    if (
        pos &&
        Number.isFinite(pos.x) &&
        Number.isFinite(pos.y)
    ) {
        moverA(pos.x, pos.y);
    } else {
        moverA(
            window.innerWidth - panel.offsetWidth - 24,
            80
        );
    }
}

function abrir(idImagen) {
    imagenActual = idImagen || imagenSeleccionada;
    nombre.textContent = "Ajustar: " + imagenActual;

    panel.hidden = false;
    restaurarPos();

    // Inicializa/actualiza la herramienta sin reposicionar
    // ni volver a abrir el panel.
    window.Distorsionator?.open();
}

function cerrar() {
    panel.hidden = true;
}

document.addEventListener("click", event => {
    const btn = event.target.closest("[data-ajustar]");

    if (!btn) return;

    event.preventDefault();
    abrir(btn.dataset.ajustar);
});

document.getElementById("panel-cerrar")
    .addEventListener("click", cerrar);

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
        cerrar();
    }
});

titulo.addEventListener("pointerdown", event => {
    if (event.target.closest("button")) return;

    const rect = panel.getBoundingClientRect();

    arrastre = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top
    };

    titulo.setPointerCapture(event.pointerId);
    titulo.classList.add("arrastrando");
});

titulo.addEventListener("pointermove", event => {
    if (!arrastre) return;

    moverA(
        event.clientX - arrastre.dx,
        event.clientY - arrastre.dy
    );
});

function terminarArrastre() {
    if (!arrastre) return;

    arrastre = null;
    titulo.classList.remove("arrastrando");
    guardarPos();
}

titulo.addEventListener("pointerup", terminarArrastre);
titulo.addEventListener("pointercancel", terminarArrastre);

window.addEventListener("resize", () => {
    if (panel.hidden) return;

    const x = parseFloat(panel.style.left);
    const y = parseFloat(panel.style.top);

    moverA(
        Number.isFinite(x) ? x : 0,
        Number.isFinite(y) ? y : 0
    );

    guardarPos();
});


const Distorsionator = (() => {
    const canvas = document.getElementById("mapCanvas");
    const panel = document.getElementById("panel-ajuste");
    const panelBody = document.getElementById("panel-cuerpo");

    if (!canvas || !panel || !panelBody) {
        console.error("Distorsionator: faltan elementos HTML.");
        return null;
    }

    // Cada punto marcado pertenece a una de estas 4 líneas.
    const ROLES = {
        m1: { nombre: "Meridiano 1", corto: "M1" },
        m2: { nombre: "Meridiano 2", corto: "M2" },
        p1: { nombre: "Paralelo 1", corto: "P1" },
        p2: { nombre: "Paralelo 2", corto: "P2" },
        a:  { nombre: "Referencia (sin línea)", corto: "R" }   // sirve solo para colocar la imagen en el mapa
    };

    const points = [];   // { id, role, source: {x, y} en la imagen, target: {x, y} en el mapa o null, sourceImageId }
    const imageIds = new WeakMap();

    let nextImageId = 1;
    let nextPointId = 1;
    let selectedImage = null;
    let selectedPointId = null;
    let mode = "source";   // "source" = marcar en la imagen · "target" = marcar en el mapa

    // Capa independiente para dibujar los marcadores.
    const markers = document.createElement("div");
    markers.id = "distorsionator-markers";

    document.body.appendChild(markers);

    // La herramienta administra su contenido, no el panel flotante.

    const ui = panelBody.querySelector("#distorsionator-ui");

    if (!ui) {
        console.error("Distorsionator: falta #distorsionator-ui en el HTML.");
        return null;
    }

    const imageSelect = ui.querySelector("#dist-image");
    const roleSelect = ui.querySelector("#dist-role");
    const sourceButton = ui.querySelector("#dist-source");
    const targetButton = ui.querySelector("#dist-target");
    const deleteButton = ui.querySelector("#dist-delete");
    const refreshButton = ui.querySelector("#dist-refresh");
    const exportButton = ui.querySelector("#dist-export");

    const warpButton = ui.querySelector("#dist-warp");
    const warpResult = ui.querySelector("#dist-warp-result");

    const instructions = ui.querySelector("#dist-instructions");
    const status = ui.querySelector("#dist-status");
    const pointList = ui.querySelector("#dist-points");
    const output = ui.querySelector("#dist-output");

    // La imagen se muestra dentro del panel y ahí se marcan los puntos.
    const previewBox = ui.querySelector("#dist-preview");
    const previewInner = ui.querySelector("#dist-preview-inner");
    const previewImg = ui.querySelector("#dist-preview-img");
    const previewMarkers = ui.querySelector("#dist-preview-markers");
    const zoomInput = ui.querySelector("#dist-zoom");


    function getImageId(img) {
        if (!imageIds.has(img)) {
            imageIds.set(img, nextImageId++);
        }

        return imageIds.get(img);
    }

    function getImages() {
        return [
            ...document.querySelectorAll(
                "#references .reference-image img"
            )
        ].filter(img =>
            img.isConnected &&
            img.complete &&
            img.naturalWidth > 0 &&
            img.naturalHeight > 0
        );
    }

    function refreshImages() {
        const previousId = selectedImage
            ? getImageId(selectedImage)
            : null;

        const images = getImages();

        imageSelect.replaceChildren();

        for (const img of images) {
            const option = document.createElement("option");
            option.value = String(getImageId(img));

            let name = img.alt;

            if (!name || name === "Referencia") {
                try {
                    name = decodeURIComponent(
                        new URL(img.currentSrc || img.src)
                            .pathname.split("/").pop()
                    );
                } catch {
                    name = `Imagen ${option.value}`;
                }
            }

            option.textContent = name || `Imagen ${option.value}`;
            imageSelect.appendChild(option);
        }

        const previousStillExists = images.find(
            img => getImageId(img) === previousId
        );

        selectedImage = previousStillExists || images[0] || null;

        if (selectedImage) {
            imageSelect.value = String(getImageId(selectedImage));
        }

        updatePreview();
        render();
    }

    // Muestra en el panel la imagen seleccionada.
    function updatePreview() {
        const src = selectedImage?.isConnected
            ? (selectedImage.currentSrc || selectedImage.src)
            : "";

        if (previewImg.dataset.src !== src) {
            previewImg.dataset.src = src;

            if (src) previewImg.src = src;
            else previewImg.removeAttribute("src");
        }

        previewBox.style.display = src ? "block" : "none";
    }

    // Puntos marcados sobre la imagen seleccionada.
    function currentPoints() {
        if (!selectedImage) return [];

        const imageId = getImageId(selectedImage);

        return points.filter(point => point.sourceImageId === imageId);
    }

    function updateInstructions() {
        if (mode === "source") {
            instructions.textContent =
                `Marcando: ${ROLES[roleSelect.value].nombre}. ` +
                "Hacé clic sobre la imagen de este panel, cada clic agrega un punto (con el zoom marcás con más precisión). " +
                "Cada meridiano necesita 2 puntos o más; cada paralelo, 1 o más (con 2 se ve si está bien marcado).";
            return;
        }

        const point = currentPoints().find(p => p.id === selectedPointId);

        instructions.textContent = point
            ? `Hacé clic en el mapa principal, en el mismo lugar que el punto ${point.id} (${ROLES[point.role].nombre}). ` +
              "Con 2 puntos o más en el mapa la imagen se coloca sola."
            : "Marcá primero puntos sobre la imagen y elegí uno de la lista.";
    }

    function setMode(newMode) {
        mode = newMode;

        sourceButton.classList.toggle("dist-active", mode === "source");
        targetButton.classList.toggle("dist-active", mode === "target");

        if (mode === "target") {
            // arranca por el primer punto que todavía no tiene lugar en el mapa
            const next = currentPoints().find(p => !p.target);
            if (next) selectedPointId = next.id;
        }

        render();
    }

    // Clic sobre la imagen del panel → píxeles de la imagen original
    function getImageCoordinates(event) {
        const rect = previewImg.getBoundingClientRect();

        if (!selectedImage || rect.width <= 0 || rect.height <= 0) {
            return null;
        }

        return {
            x: (event.clientX - rect.left) *
                selectedImage.naturalWidth / rect.width,

            y: (event.clientY - rect.top) *
                selectedImage.naturalHeight / rect.height
        };
    }

    function getCanvasCoordinates(event) {
        const rect = canvas.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) {
            return null;
        }

        return screenToWorld(
            event.clientX - rect.left,
            event.clientY - rect.top,
            canvas
        );
    }

    // Posición en pantalla de un punto marcado sobre el mapa
    function targetToScreen(target) {
        const rect = canvas.getBoundingClientRect();

        let dx = target.x - camera.x;

        // con wrap horizontal el mismo punto del mundo se repite: se toma la copia visible
        if (state.wrapHorizontal) {
            const mapW = logicCanvas.width;
            dx = ((dx % mapW) + mapW) % mapW;
        }

        return {
            x: rect.left + dx * camera.zoom,
            y: rect.top + (target.y - camera.y) * camera.zoom
        };
    }

    function markSource(event) {
        if (!selectedImage) return;

        const coordinates = getImageCoordinates(event);
        if (!coordinates) return;

        const point = {
            id: nextPointId++,
            role: roleSelect.value,
            source: coordinates,
            target: null,
            sourceImageId: getImageId(selectedImage)
        };

        points.push(point);
        selectedPointId = point.id;

        render();
    }

    function markTarget(event) {
        const point = currentPoints().find(p => p.id === selectedPointId);

        if (!point) {
            status.textContent = "Marcá primero puntos sobre la imagen y elegí uno de la lista.";
            return;
        }

        const coordinates = getCanvasCoordinates(event);
        if (!coordinates) return;

        point.target = coordinates;

        // pasa al siguiente punto que todavía no tenga lugar en el mapa
        const next = currentPoints().find(p => !p.target);
        if (next) selectedPointId = next.id;

        render();
    }

    function createMarker(x, y, point, side) {
        const marker = document.createElement("div");
        marker.className = `dist-marker ${side} role-${point.role}`;

        if (point.id === selectedPointId) {
            marker.classList.add("selected");
        }

        marker.style.left = `${x}px`;
        marker.style.top = `${y}px`;

        const label = document.createElement("span");
        label.textContent = `${ROLES[point.role].corto}·${point.id}`;

        marker.appendChild(label);
        markers.appendChild(marker);
    }

    // Marcador sobre la imagen del panel (posición en %, así sigue a la imagen con el zoom)
    function createPreviewMarker(point) {
        const marker = document.createElement("div");
        marker.className = `dist-marker source role-${point.role}`;

        if (point.id === selectedPointId) {
            marker.classList.add("selected");
        }

        marker.style.position = "absolute";
        marker.style.pointerEvents = "none";
        marker.style.left = `${point.source.x / selectedImage.naturalWidth * 100}%`;
        marker.style.top = `${point.source.y / selectedImage.naturalHeight * 100}%`;

        const label = document.createElement("span");
        label.textContent = `${ROLES[point.role].corto}·${point.id}`;

        marker.appendChild(label);
        previewMarkers.appendChild(marker);
    }

    function renderMarkers() {
        markers.replaceChildren();
        previewMarkers.replaceChildren();

        if (!selectedImage?.isConnected) return;

        for (const point of currentPoints()) {
            createPreviewMarker(point);

            if (point.target) {
                const screen = targetToScreen(point.target);
                createMarker(screen.x, screen.y, point, "target");
            }
        }
    }

    function renderPointList() {
        pointList.replaceChildren();

        for (const point of currentPoints()) {
            const row = document.createElement("div");
            row.className = "dist-point";

            if (point.id === selectedPointId) {
                row.classList.add("selected");
            }

            const targetText = point.target
                ? `(${point.target.x.toFixed(1)}, ${point.target.y.toFixed(1)})`
                : "sin lugar en el mapa";

            row.textContent =
                `Punto ${point.id} | ${ROLES[point.role].nombre} | ` +
                `Imagen: (${point.source.x.toFixed(1)}, ${point.source.y.toFixed(1)}) | ` +
                `Mapa: ${targetText}`;

            row.addEventListener("click", () => {
                selectedPointId = point.id;
                render();
            });

            pointList.appendChild(row);
        }
    }

    function renderStatus() {
        const count = role =>
            currentPoints().filter(point => point.role === role).length;

        const inMap = currentPoints().filter(point => point.target).length;

        status.textContent =
            `Puntos → M1: ${count("m1")} · M2: ${count("m2")} · ` +
            `P1: ${count("p1")} · P2: ${count("p2")} · R: ${count("a")} · ` +
            `En el mapa: ${inMap} · Modo: ${mode === "source" ? "imagen" : "mapa"}`;
    }

    function render() {
        updateInstructions();
        renderPointList();
        renderMarkers();
        renderStatus();
        output.textContent = "";
    }

    function GenerarDistorsion() {
        //Transformación afín

    }

    function TransforarAfin(x, y, t) {
        return {
            x: t.a * x + t.b * y + t.c,
            y: t.d * x + t.e * y + t.f
        };
    }

    function exportJSON() {
        const sourceImage = selectedImage;

        const data = {
            version: 2,

            sourceImage: sourceImage
                ? {
                    name: sourceImage.alt || sourceImage.src,
                    width: sourceImage.naturalWidth,
                    height: sourceImage.naturalHeight
                }
                : null,

            targetCanvas: {
                width: canvas.width,
                height: canvas.height
            },

            points: currentPoints().map(point => ({
                id: point.id,
                role: point.role,
                source: { ...point.source },
                target: point.target ? { ...point.target } : null
            }))
        };

        const json = JSON.stringify(data, null, 2);
        output.textContent = json;

        const blob = new Blob(
            [json],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "distorsionator-points.json";
        link.click();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    imageSelect.addEventListener("change", () => {
        const id = Number(imageSelect.value);

        selectedImage = getImages().find(
            img => getImageId(img) === id
        ) || null;

        updatePreview();
        render();
    });

    roleSelect.addEventListener("change", updateInstructions);
    sourceButton.addEventListener("click", () => setMode("source"));
    targetButton.addEventListener("click", () => setMode("target"));

    previewImg.addEventListener("click", event => {
        if (mode === "source") markSource(event);
    });

    zoomInput.addEventListener("input", () => {
        previewInner.style.width = `${zoomInput.value}%`;
    });
    refreshButton.addEventListener("click", refreshImages);
    exportButton.addEventListener("click", exportJSON);


    // Descarga de respaldo, por si no se puede agregar la imagen al mapa.
    function showDownload(resultCanvas) {
        const download = document.createElement("a");
        download.textContent = "Descargar imagen rectangular";
        download.href = resultCanvas.toDataURL("image/png");
        download.download = "mapa-rectangular.png";
        download.style.display = "inline-block";
        download.style.marginTop = "8px";

        warpResult.replaceChildren(download);
    }

        // references.js solo muestra las imágenes con su proporción original. Entonces la proporción
    // que tiene que tener en el mapa se "hornea" en los píxeles: se estira solo el eje que hace falta.
    function ajustarProporcion(resultCanvas, placement) {
        const aspecto = placement.width / placement.height;
        let w = resultCanvas.width;
        let h = resultCanvas.height;

        if (aspecto >= w / h) w = Math.round(h * aspecto);
        else h = Math.round(w / aspecto);

        // mismos topes que la geometría, para no quedarse sin memoria
        const f = Math.min(1, 8192 / Math.max(w, h), Math.sqrt(40e6 / (w * h)));
        w = Math.max(1, Math.round(w * f));
        h = Math.max(1, Math.round(h * f));

        if (w === resultCanvas.width && h === resultCanvas.height) return resultCanvas;

        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;

        const cctx = c.getContext("2d");
        cctx.imageSmoothingEnabled = true;
        cctx.imageSmoothingQuality = "high";
        cctx.drawImage(resultCanvas, 0, 0, w, h);

        return c;
    }

    // Agrega la imagen al mapa como si la hubieras cargado con el botón ➕ (así main.js la
    // maneja normal: ocultar, borrar, opacidad...) y después la acomoda en pantalla.
    function addToMap(resultCanvas, placement) {
        return new Promise((resolve, reject) => {
            const input = document.getElementById("AddRefImage");
            const container = document.getElementById("references");

            if (!input || !container) {
                reject(new Error("No encontré #AddRefImage o #references."));
                return;
            }

            ajustarProporcion(resultCanvas, placement).toBlob(blob => {
                if (!blob) {
                    reject(new Error("No pude generar el PNG."));
                    return;
                }

                const before = new Set(container.querySelectorAll(".reference-image"));

                const timer = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error("main.js no agregó la imagen al mapa."));
                }, 4000);

                const observer = new MutationObserver(() => {
                    const holder = [...container.querySelectorAll(".reference-image")]
                        .find(el => !before.has(el));

                    if (!holder) return;

                    observer.disconnect();
                    clearTimeout(timer);

                    const img = holder.querySelector("img");

                    // posición y tamaño en coordenadas del MUNDO, como los maneja references.js
                    const place = () => {
                        holder._worldX = placement.left;
                        holder._worldY = placement.top;
                        holder._baseWidth = placement.width;
                        holder._updateReference();
                    };

                    const done = () => {
                        place();
                        resolve();
                    };

                    if (img.complete && img.naturalWidth > 0) done();
                    else img.addEventListener("load", done, { once: true });
                });

                observer.observe(container, { childList: true, subtree: true });

                const transfer = new DataTransfer();
                transfer.items.add(new File([blob], "mapa-rectangular.png", { type: "image/png" }));

                input.files = transfer.files;
                input.dispatchEvent(new Event("change", { bubbles: true }));
            }, "image/png");
        });
    }

    warpButton.addEventListener("click", async () => {
        if (!selectedImage || !selectedImage.isConnected) {
            status.textContent = "Seleccioná una imagen de origen.";
            return;
        }

        const withTarget = currentPoints().filter(point => point.target);

        if (withTarget.length < 2) {
            status.textContent =
                "Hacen falta al menos 2 puntos marcados también en el mapa (botón \"Punto en mapa\").";
            return;
        }

        // Junta los puntos de cada línea: [{ x, y }, ...]
        const puntosDe = role => currentPoints()
            .filter(point => point.role === role)
            .map(point => ({ x: point.source.x, y: point.source.y }));

        const lineas = {
            meridianos: [puntosDe("m1"), puntosDe("m2")],
            paralelos: [puntosDe("p1"), puntosDe("p2")]
        };

        warpButton.disabled = true;
        status.textContent = "Generando…";
        warpResult.replaceChildren();

        // deja que el navegador pinte el mensaje antes de trabajar
        await new Promise(resolve => setTimeout(resolve, 30));

        let result = null;

        try {
            result = desenrollarCono(selectedImage, lineas);

            // dónde cae cada punto en la imagen resultante vs. dónde lo marcaste en el mapa
            const placement = ajustarEscala(withTarget.map(point => ({
                from: proyectarPunto(result, point.source.x, point.source.y),
                to: point.target
            })));

            await addToMap(result.canvas, {
                left: placement.tx,
                top: placement.ty,
                width: result.W * placement.sx,
                height: result.H * placement.sy
            });

            refreshImages();

            // Radio de cada paralelo y cuánto se desvían sus puntos entre sí
            // (desvío alto = los puntos de ese paralelo no están a la misma altura).
            const radios = result.paralelos
                .map((p, i) => p
                    ? `P${i + 1}: radio ${p.radio.toFixed(0)} px` +
                      (p.puntos > 1 ? ` (desvío ${p.desvio.toFixed(1)} px)` : "")
                    : null)
                .filter(Boolean)
                .join(" · ");

            status.textContent =
                `Imagen colocada en el mapa (${result.W}×${result.H} px). ` +
                `Error medio de las parejas: ${placement.residuo.toFixed(1)} px de pantalla. ` +
                `Vértice del cono en (${result.vertice.x.toFixed(0)}, ${result.vertice.y.toFixed(0)}). ${radios}.`;
        } catch (error) {
            console.error("Distorsionator:", error);
            status.textContent = error.message ||
                "No se pudo generar la imagen.";

            // si ya se generó pero no se pudo colocar, que no se pierda el trabajo
            if (result) showDownload(result.canvas);
        } finally {
            warpButton.disabled = false;
        }
    });


    deleteButton.addEventListener("click", () => {
        const visibles = currentPoints();
        const index = visibles.findIndex(
            point => point.id === selectedPointId
        );

        if (index === -1) return;

        points.splice(points.indexOf(visibles[index]), 1);

        selectedPointId = visibles[index + 1]?.id ??
            visibles[index - 1]?.id ??
            null;

        render();
    });

    // En modo "mapa", los clics sobre el canvas marcan el punto elegido en vez de pintar.
    // El resto de los eventos del editor no se modifica.
    document.addEventListener("click", event => {
        if (panel.hidden || mode !== "target") return;

        if (event.target === canvas) {
            event.preventDefault();
            event.stopImmediatePropagation();
            markTarget(event);
        }
    }, true);

    // API pública. No abre, cierra ni posiciona el panel.
    function open() {
        refreshImages();
        setMode("source");
    }

    function refresh() {
        refreshImages();
    }

    refreshImages();
    setMode("source");

    // Los marcadores del mapa siguen a la cámara: se redibujan cuando cambia
    let lastCamera = "";

    function watchCamera() {
        const key = `${camera.x}|${camera.y}|${camera.zoom}`;

        if (key !== lastCamera) {
            lastCamera = key;
            if (!panel.hidden) renderMarkers();
        }

        requestAnimationFrame(watchCamera);
    }

    watchCamera();

    const api = {
        open,
        refresh,
        points
    };

    window.Distorsionator = api;

    return api;
})();