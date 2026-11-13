const PLACEHOLDER = "imgs/placeholder.png";

function makeIcon(src, lazy = false) {
    const img = document.createElement("img");
    img.className = "picker-icon";
    img.alt = "";
    if (lazy) img.loading = "lazy";
    // si no existe la imagen, usa la stock (sin entrar en bucle si la stock tampoco existe)
    img.addEventListener("error", () => {
        if (!img.src.endsWith(PLACEHOLDER)) img.src = PLACEHOLDER;
    });
    img.src = src;
    return img;
}

export async function loadEU4Lists(url = "maps_data/eu4_lists.json") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
    return res.json();
}

// root: <div> vacío. iconDir: carpeta de iconos, un archivo por id (ej: imgs/tradegoods/grain.png)
export function createPicker(root, iconDir) {
    root.classList.add("picker");
    root.innerHTML = "";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-button";
    const buttonName = document.createElement("span");
    buttonName.className = "picker-name";
    
    const buttonIcon = iconDir ? makeIcon(PLACEHOLDER) : null;   // sin iconDir: sin íconos (culturas)
    button.append(buttonName);
    if (buttonIcon) button.append(buttonIcon);

    const panel = document.createElement("div");
    panel.className = "picker-panel";
    panel.hidden = true;
    const search = document.createElement("input");
    search.type = "text";
    search.className = "picker-search";
    search.placeholder = "Buscar...";
    const list = document.createElement("ul");
    list.className = "picker-list";
    panel.append(search, list);
    root.append(button, panel);

    let items = [];
    let value = null;
    const iconFor = id => `${iconDir}/${id}.png`;

    function renderButton() {
        const found = items.find(it => it.id === value);
        buttonName.textContent = value ? (found ? found.name : value) : "—";
        if (buttonIcon) {
            buttonIcon.style.visibility = value ? "visible" : "hidden";
            if (value) buttonIcon.src = iconFor(value);
        }
    }

    function markActive() {
        for (const li of list.children) {
            li.classList.toggle("picker-item--active", li.dataset.id === (value ?? ""));
        }
    }

    function filter(q) {
        for (const li of list.children) {
            li.style.display = (q !== "" && !li.dataset.search.includes(q)) ? "none" : "";
        }
    }

    function open() {
        panel.hidden = false;
        search.value = "";
        filter("");
        search.focus();
        list.querySelector(".picker-item--active")?.scrollIntoView({ block: "nearest" });
    }

    function close() {
        panel.hidden = true;
    }

    function choose(id) {
        value = id;
        renderButton();
        markActive();
        close();
        api.onChange?.(id);
    }

    function setItems(newItems) {
        items = newItems;
        list.innerHTML = "";
        for (const it of [{ id: null, name: "—" }, ...items]) {
            const li = document.createElement("li");
            li.className = "picker-item";
            li.dataset.id = it.id ?? "";
            li.dataset.search = it.name.toLowerCase();
            const name = document.createElement("span");
            name.textContent = it.name;
            li.append(name);
            if (it.id && iconDir) li.append(makeIcon(iconFor(it.id), true));
            li.addEventListener("click", () => choose(it.id));
            list.append(li);
        }
        renderButton();
        markActive();
    }

    // cambia lo que se ve, sin disparar onChange
    function setValue(id) {
        value = id ?? null;
        renderButton();
        markActive();
    }

    button.addEventListener("click", () => (panel.hidden ? open() : close()));
    search.addEventListener("input", () => filter(search.value.trim().toLowerCase()));
    root.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    document.addEventListener("click", e => { if (!root.contains(e.target)) close(); });

    const api = { onChange: null, setItems, setValue };
    renderButton();
    return api;
}