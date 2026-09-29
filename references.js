// references.js
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

    function addItem(ref) {
        const el = template.content.cloneNode(true).querySelector(".refImage");
        el.querySelector(".ref-preview").src = ref.thumbUrl;

        const btnDelete = el.querySelector(".ref-delete");
        const btnHide   = el.querySelector(".ref-hide");
        const btnBlur   = el.querySelector(".ref-blur");
        const slider    = el.querySelector(".ref-opacity");
        const label     = el.querySelector(".ref-opacity-label");

        btnDelete.addEventListener("click", () => {
            const i = references.indexOf(ref);
            if (i !== -1) references.splice(i, 1);
            ref.bitmap.close();                  // libera la memoria de la imagen
            URL.revokeObjectURL(ref.thumbUrl);
            el.remove();
            onChange();
        });

        btnHide.addEventListener("click", () => {
            ref.visible = !ref.visible;
            el.classList.toggle("is-hidden", !ref.visible);
            onChange();
        });

        btnBlur.addEventListener("click", () => {
            ref.pixelated = !ref.pixelated;
            btnBlur.classList.toggle("is-on", ref.pixelated);
            onChange();
        });

        slider.addEventListener("input", () => {
            ref.opacity = slider.value / 100;
            label.textContent = `${slider.value}%`;
            onChange();
        });

        list.prepend(el); // la más nueva arriba en la lista, y al final del array (dibujada encima)
    }
}