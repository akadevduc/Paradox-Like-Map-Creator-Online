import { brushColor, colorInicial,
         provinceData, waterColor, state } from "./state.js";
import { updateBaseMapColor, addBorders,
         renderFromBase }                      from "./provinces.js";

// =======================
// SISTEMA DE PAÍSES
// =======================
export const countries = new Map(); // hex -> { name, color:[r,g,b] }

export function rgbToHex(rgb) {
    return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

export function registerCountry(hex, name = null) {
    if (!countries.has(hex)) {
        countries.set(hex, {
            name:  name ?? `País ${countries.size + 1}`,
            color: hexToRgb(hex),
            flag: null,
        });
    } else if (name) {
        countries.get(hex).name = name;
    }
}

export function selectCountryColor(hex) {
    brushColor.rgb = hexToRgb(hex);
    const swatch = document.getElementById('brushColorDisplay');
    if (swatch) swatch.style.backgroundColor = hex;
    document.querySelectorAll('.country-item').forEach(el => {
        el.classList.toggle('country-item--active', el.dataset.hex === hex);
    });
}

export function changeCountryColor(oldHex, newHex) {
    if (oldHex === newHex || !countries.has(oldHex)) return;
    const country = countries.get(oldHex);
    const newRgb  = hexToRgb(newHex);

    Object.values(provinceData).forEach(pd => {
        if (rgbToHex(pd.paintColor) === oldHex) {
            pd.paintColor = [...newRgb];
            updateBaseMapColor(pd.id);
        }
    });

    countries.delete(oldHex);
    country.color = newRgb;
    countries.set(newHex, country);

    if (rgbToHex(brushColor.rgb) === oldHex) selectCountryColor(newHex);

    addBorders();
    renderFromBase();
    renderCountryList();
}

export function renderCountryList() {
    const list = document.getElementById('countryList');
    if (!list) return;
    list.innerHTML = '';

    if (countries.size === 0) {
        list.innerHTML = '<li class="country-empty">Todavía no hay países. Pintá una provincia para empezar.</li>';
        return;
    }

    const activeHex = rgbToHex(brushColor.rgb);

    countries.forEach((country, hex) => {
        const li = document.createElement('li');
        li.className  = 'country-item' + (hex === activeHex ? ' country-item--active' : '');
        li.dataset.hex = hex;

        const flagStyle = country.flag 
            ? `background-image:url('${country.flag}');background-size:cover;background-position:center;`
            : `background:${hex};`;

        li.innerHTML =
            `<button class="country-flag-thumb" style="${flagStyle}" title="Bandera"></button>` +
            `<input  class="country-name" type="text" value="${country.name}" spellcheck="false" />` +
            `<span   class="country-hex">${hex.toUpperCase()}</span>` +
            `<input  class="country-color-picker" type="color" value="${hex}" title="Cambiar color del país" />` +
            `<button class="country-copy-btn" title="Copiar color al pincel">▶</button>`;

        li.querySelector('.country-flag-thumb').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = () => {
                const file = input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = e => {
                    const flagDataUrl = e.target.result;
                    if (countries.has(hex)) {
                        countries.get(hex).flag = flagDataUrl;
                    }
                    li.querySelector('.country-flag-thumb').style.backgroundImage = `url('${flagDataUrl}')`;
                    li.querySelector('.country-flag-thumb').style.backgroundSize = 'cover';
                };
                reader.readAsDataURL(file);
            };
            input.click();
        });

        li.querySelector('.country-copy-btn').addEventListener('click', () => selectCountryColor(hex));

        list.appendChild(li);
    });
}

export function initCountriesFromProvinceData() {
    countries.clear();
    const colorInicialHex = rgbToHex(colorInicial);
    Object.values(provinceData).forEach(pd => {
        if (pd.isWater) return;
        const hex = rgbToHex(pd.paintColor);
        if (hex === colorInicialHex) return;
        registerCountry(hex, pd.owner ?? null);
    });
    renderCountryList();
}

export function showProvinceAndCountryInfo(provinceId = state.pinnedProvince) {
    if (!provinceId || !provinceData[provinceId]) return;

    const ProvinceIdEl = document.getElementById("ProvinceId");
    const CountryNameEl = document.getElementById("CountryName");
    const CountryColorEl = document.getElementById("CountryColor");
    const CountryFlagEl = document.getElementById("CountryFlag");
    const CountryFlagPreviewEl = document.getElementById("CountryFlagPreview");

    if (!ProvinceIdEl || !CountryNameEl || !CountryColorEl) return;

    const pd = provinceData[provinceId];
    const hex = rgbToHex(pd.paintColor);

    const countryName = countries.get(hex)?.name ?? pd.name; //cambia el nombre

    CountryNameEl.value = countryName;
    CountryColorEl.value = hex;
    ProvinceIdEl.textContent = pd.id; //de la provincia

        CountryNameEl.onchange = () => {
        const newName = CountryNameEl.value.trim();
        if (newName) {
            registerCountry(hex, newName);
            renderCountryList();
        }
    };
    CountryFlagPreviewEl.src = countries.get(hex)?.flag ?? 'imgs/placeholder.png';

    CountryFlagEl.onchange = () => {
        changeCountryFlag(CountryFlagPreviewEl, CountryFlagEl, hex);
    };
    CountryColorEl.onchange = () => { //cambia el color
        changeCountryColor(hex, CountryColorEl.value);
    };
}

document.getElementById("CountryFlag").addEventListener("change", function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById("CountryFlagPreview").src = e.target.result;
    };
    reader.readAsDataURL(file);
});

function changeCountryFlag(CountryFlagPreviewEl, CountryFlagEl, hex) {
    const file = CountryFlagEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const flagDataUrl = e.target.result;
        if (countries.has(hex)) {
            countries.get(hex).flag = flagDataUrl;
        }
        if (CountryFlagPreviewEl) CountryFlagPreviewEl.src = flagDataUrl;
        
        // Actualizar el thumb en la lista si existe
        const thumb = document.querySelector(`.country-item[data-hex="${hex}"] .country-flag-thumb`);
        if (thumb) {
            thumb.style.backgroundImage = `url('${flagDataUrl}')`;
            thumb.style.backgroundSize = 'cover';
            thumb.style.backgroundPosition = 'center';
        }
    };
    reader.readAsDataURL(file);
}