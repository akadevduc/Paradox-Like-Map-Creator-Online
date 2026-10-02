import { camera, handleZoom } from "./camera.js";
import { canvas } from "./main.js";

export const references = []; // orden de dibujado: el último queda por encima

const MAX_SIDE = 4096; // tope al cargar: una imagen decodificada ocupa ancho*alto*4 bytes

async function loadBitmap(file) {
    let bitmap = await createImageBitmap(file);
    const biggest = Math.max(bitmap.width, bitmap.height);
    if (biggest > MAX_SIDE) {
        const k = MAX_SIDE / biggest;
        const small = await createImageBitmap(bitmap, {
            resizeWidth:  Math.round(bitmap.width  * k),
            resizeHeight: Math.round(bitmap.height * k),
            resizeQuality: "high"
        });
        bitmap.close();
        bitmap = small;
    }
    return bitmap;
}

// Miniatura chica para el panel, así el <img> no decodifica otra vez la imagen completa
async function makeThumbUrl(bitmap, maxSide = 200) {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width  * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const c = new OffscreenCanvas(w, h);
    c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    return URL.createObjectURL(await c.convertToBlob());
}

export function initReferences(onChange) {
    const input    = document.getElementById("AddRefImage");
    const list     = document.getElementById("RefList");
    const template = document.getElementById("RefItemTemplate");

    input.addEventListener("change", async () => {
        const file = input.files[0];
        input.value = ""; // el input queda libre para agregar la siguiente
        if (!file) return;

        let bitmap;
        try {
            bitmap = await loadBitmap(file);
        } catch (err) {
            console.error("No se pudo decodificar la imagen:", err);
            return;
        }

        const ref = {
            bitmap,
            x: 0, y: 0, scale: 1,      // en coordenadas del mapa (los usamos en el paso de dibujado)
            opacity: 1,
            visible: true,
            pixelated: false,
            thumbUrl: await makeThumbUrl(bitmap),
        };

        addItem(ref);
        references.push(ref);
        onChange();
    });

    const referencesContainer = document.getElementById("references");
    const referenceImg = document.getElementById("referenceImg");

    function addItem(ref) {
        const el = template.content.cloneNode(true).querySelector(".refImage");

        el.querySelector(".ref-preview").src = ref.thumbUrl;

        const fragment = referenceImg.content.cloneNode(true);
        const element = fragment.querySelector(".reference-image");

        const img = element.querySelector("img");
        img.src = ref.thumbUrl;

        referencesContainer.appendChild(element);
        enableImageMovement(element, ref);

        console.log(referencesContainer);

        const btnDelete = el.querySelector(".ref-delete");
        const btnHide   = el.querySelector(".ref-hide");
        const btnBlock  = el.querySelector(".ref-block");
        const btnBlur   = el.querySelector(".ref-blur");
        const slider    = el.querySelector(".ref-opacity");
        const label     = el.querySelector(".ref-opacity-label");

        const resizeButtons = element.querySelector(".resizeButtons");

        btnDelete.addEventListener("click", () => {
            const i = references.indexOf(ref);
            if (i !== -1) references.splice(i, 1);
            ref.bitmap.close();                  // libera la memoria de la imagen
            URL.revokeObjectURL(ref.thumbUrl);
            el.remove();
            img.remove();
            onChange();
        });

        btnHide.addEventListener("click", () => {
            ref.visible = !ref.visible;
            el.classList.toggle("is-hidden", !ref.visible);
            img.style.display = ref.visible ? "" : "none";
            onChange();
        });

        btnBlock.addEventListener("click", () => {
            ref.blocked = !ref.blocked;
            btnBlock.classList.toggle("is-on", ref.blocked);

            if (ref.blocked) {
                resizeButtons.style.display = "none";
                img.style.pointerEvents = "none";

                btnBlock.textContent = "🔒";
            } else {
                resizeButtons.style.display = "";
                img.style.pointerEvents = "";

                btnBlock.textContent = "🔓";
            }

            onChange();
        });

        btnBlur.addEventListener("click", () => {
            ref.pixelated = !ref.pixelated;
            btnBlur.classList.toggle("is-on", ref.pixelated);
            img.style.imageRendering = ref.pixelated ? "pixelated" : "auto";
            onChange();
        });

        slider.addEventListener("input", () => {
            ref.opacity = slider.value / 100;
            label.textContent = `${slider.value}%`;
            img.style.opacity = ref.opacity;
            onChange();
        });

        list.prepend(el); // la más nueva arriba en la lista, y al final del array (dibujada encima)
    }
    
}

function enableImageMovement(element, ref) {
    const img = element.querySelector("img");
    const resizeButtons = element.querySelectorAll(".ref-resize");

    let action = null;
    let startX = 0;
    let startY = 0;
    let startWorldX = 0;
    let startWorldY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let startMouseX = 0;
    let startMouseY = 0;

    const canvasRect = () => canvas.getBoundingClientRect();

    function updatePosition() {
        const rect = canvasRect();

        element.style.left = `${rect.left + (element._worldX - camera.x) * camera.zoom}px`;
        element.style.top = `${rect.top + (element._worldY - camera.y) * camera.zoom}px`;

        img.style.width = `${element._baseWidth * camera.zoom}px`;
        img.style.height = "auto";
    }

    function initialize() {
        const rect = canvasRect();

        img.draggable = false;   // ← agregar esta línea

        element._baseWidth = img.naturalWidth / camera.zoom;
        element._worldX = (parseFloat(element.style.left) || 100 - rect.left) / camera.zoom + camera.x;
        element._worldY = (parseFloat(element.style.top) || 100 - rect.top) / camera.zoom + camera.y;

        updatePosition();
    }

    if (img.complete && img.naturalWidth > 0) {
        initialize();
    } else {
        img.addEventListener("load", initialize, { once: true });
    }

    element.addEventListener("mousedown", e => {
        if (ref.blocked) return;
        if (e.target.closest(".ref-resize")) return;

        action = "move";

        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startWorldX = element._worldX;
        startWorldY = element._worldY;

        e.preventDefault();
    });

    resizeButtons.forEach(button => {
        button.addEventListener("mousedown", e => {
            if (ref.blocked) return;

            action = button.className.match(/ref-resize-(nw|ne|sw|se)/)?.[1];

            startMouseX = e.clientX;
            startMouseY = e.clientY;
            startWidth = img.getBoundingClientRect().width;
            startHeight = img.getBoundingClientRect().height;
            startWorldX = element._worldX;
            startWorldY = element._worldY;

            e.preventDefault();
            e.stopPropagation();
        });
    });

    document.addEventListener("mousemove", e => {
        if (!action) return;

        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;

        if (action === "move") {
            element._worldX = startWorldX + dx / camera.zoom;
            element._worldY = startWorldY + dy / camera.zoom;
        } else {
            const aspect = startHeight / startWidth;

            let newWidth = startWidth;

            if (action === "se" || action === "ne") {
                newWidth = startWidth + dx;
            } else {
                newWidth = startWidth - dx;
            }

            newWidth = Math.max(20, newWidth);

            const newHeight = newWidth * aspect;

            const deltaWidth = (newWidth - startWidth) / camera.zoom;
            const deltaHeight = (newHeight - startHeight) / camera.zoom;

            element._worldX = startWorldX;
            element._worldY = startWorldY;

            if (action === "nw" || action === "sw") {
                element._worldX -= deltaWidth;
            }

            if (action === "nw" || action === "ne") {
                element._worldY -= deltaHeight;
            }

            element._baseWidth = newWidth / camera.zoom;
        }

        updatePosition();
    });

    document.addEventListener("mouseup", () => {
        action = null;
    });

    element._updateReference = updatePosition;

    element.addEventListener("wheel", handleZoom, { passive: false });
}

export function updateReferences() {
    document.querySelectorAll("#references .reference-image").forEach(element => {
        if (element._updateReference) {
            element._updateReference();
        }
    });
}