import { brushColor, colorInicial,
         provinceData, waterColor, state } from "./state.js";
import { updateBaseMapColor, addBorders,
         renderFromBase }                      from "./provinces.js";

// =======================
// SISTEMA DE PAÍSES
// countries: hex -> { name, color:[r,g,b], flag, locked }
//   locked = true  → las provincias de este país NO se pueden editar
//                    (pintar, cortar, cuentagotas, balde)
//   Por defecto el país del agua (océano) nace locked.
// =======================
export const countries = new Map();

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

export function registerCountry(hex, name = null, locked = false) {
    if (!countries.has(hex)) {
        countries.set(hex, {
            name:  name ?? `País ${countries.size + 1}`,
            color: hexToRgb(hex),
            flag:  null,
            locked,
        });
    } else {
        const c = countries.get(hex);
        if (name) c.name = name;
        // locked solo se fuerza al registrar por primera vez
    }
}

// Hex del país al que pertenece una provincia (según su paintColor)
export function getProvinceCountryHex(provinceId) {
    const pd = provinceData[provinceId];
    if (!pd) return null;
    return rgbToHex(pd.paintColor);
}

// ¿Está bloqueado el país de esta provincia?
export function isCountryLocked(provinceId) {
    const hex = getProvinceCountryHex(provinceId);
    if (!hex) return false;
    const c = countries.get(hex);
    return c ? !!c.locked : false;
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
    country.locked = country.locked; // se conserva
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

        const lockIcon = country.locked ? '🔒' : '🔓';

        li.innerHTML =
            `<button class="country-flag-thumb" style="${flagStyle}" title="Bandera"></button>` +
            `<input  class="country-name" type="text" value="${country.name}" spellcheck="false" />` +
            `<span   class="country-hex">${hex.toUpperCase()}</span>` +
            `<input  class="country-color-picker" type="color" value="${hex}" title="Cambiar color del país" />` +
            `<button class="country-copy-btn" title="Copiar color al pincel">▶</button>` +
            `<button class="country-lock-btn" title="Bloquear/Desbloquear edición de este país">${lockIcon}</button>`;

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

        li.querySelector('.country-color-picker').addEventListener('change', e => {
            changeCountryColor(hex, e.target.value);
        });

        li.querySelector('.country-copy-btn').addEventListener('click', () => selectCountryColor(hex));

        li.querySelector('.country-lock-btn').addEventListener('click', () => {
            if (!countries.has(hex)) return;
            countries.get(hex).locked = !countries.get(hex).locked;
            console.log("[COUNTRY_LOCK] país:", hex, "locked:", countries.get(hex).locked);
            renderCountryList();
        });

        list.appendChild(li);
    });
}

export function initCountriesFromProvinceData() {
    countries.clear();
    const colorInicialHex = rgbToHex(colorInicial);
    const waterHex       = rgbToHex(waterColor.rgb);
    Object.values(provinceData).forEach(pd => {
        const hex = rgbToHex(pd.paintColor);
        if (hex === colorInicialHex) return;
        if (pd.isWater) {
            // El país del agua nace bloqueado
            if (!countries.has(hex)) {
                countries.set(hex, {
                    name:  pd.name ?? "Agua",
                    color: hexToRgb(hex),
                    flag:  null,
                    locked: true,
                });
            }
            return;
        }
        registerCountry(hex, pd.owner ?? null);
    });
    if (!countries.has(waterHex)) {
        // Asegurar que el país agua exista aunque ninguna provincia lo use aún
        countries.set(waterHex, {
            name:  "Agua",
            color: hexToRgb(waterHex),
            flag:  null,
            locked: true,
        });
    }
    renderCountryList();
}

export function showProvinceAndCountryInfo(provinceId = state.pinnedProvince) {
    if (!provinceId || !provinceData[provinceId]) return;

    const ProvinceIdEl = document.getElementById("ProvinceId");
    const ProvinceNameEl = document.getElementById("ProvinceName");
    const ProvinceRGOEl = document.getElementById("ProvinceRGO");
    const ProvincePopulationEl = document.getElementById("ProvincePopulation");
    const ProvinceIsWaterEl = document.getElementById("ProvinceIsWater");
    const CountryLockedEl = document.getElementById("CountryLocked");
    const CountryNameEl = document.getElementById("CountryName");
    const CountryColorEl = document.getElementById("CountryColor");
    const CountryFlagEl = document.getElementById("CountryFlag");
    const CountryFlagPreviewEl = document.getElementById("CountryFlagPreview");

    if (!ProvinceIdEl || !CountryNameEl || !CountryColorEl || !ProvinceIsWaterEl || !CountryLockedEl) return;

    const pd = provinceData[provinceId];
    const hex = rgbToHex(pd.paintColor);

    const countryName = countries.get(hex)?.name ?? pd.name;

    const country = countries.get(hex);

    ProvinceIdEl.textContent = pd.id;
    ProvinceNameEl.value = pd.name;
    ProvinceRGOEl.value = pd.RGO ?? "";
    ProvincePopulationEl.value = pd.POP ?? "";
    CountryNameEl.value = countryName;
    CountryColorEl.value = hex;

    // El "Es agua" de la provincia está ligado al país al que pertenece:
    //   - Si el color de la provincia es el color de agua → es agua.
    //   - Si el país está bloqueado, el checkbox está disabled (no se puede cambiar libremente).
    const waterHex = rgbToHex(waterColor.rgb);
    const countryLocked = country ? !!country.locked : false;
    ProvinceIsWaterEl.checked = (hex === waterHex) || pd.isWater;
    ProvinceIsWaterEl.disabled = countryLocked;

    CountryLockedEl.checked = countryLocked;

    ProvinceNameEl.onchange = () => {
        pd.name = ProvinceNameEl.value.trim() || `Provincia ${pd.id}`;
    };
    ProvinceRGOEl.onchange = () => {
        pd.RGO = parseInt(ProvinceRGOEl.value) || 0;
    };
    ProvincePopulationEl.onchange = () => {
        pd.POP = parseInt(ProvincePopulationEl.value) || 0;
    };

    ProvinceIsWaterEl.onchange = () => {
        if (countryLocked) {
            console.log("[PROVINCE_IS_WATER] Bloqueado - no se puede cambiar. provinciaId:", provinceId);
            // re-sincronizar el checkbox
            ProvinceIsWaterEl.checked = (hex === waterHex) || pd.isWater;
            return;
        }
        const nowWater = ProvinceIsWaterEl.checked;
        console.log("[PROVINCE_IS_WATER] provinciaId:", provinceId, "nowWater:", nowWater);

        if (nowWater) {
            // Mover la provincia al país Agua
            pd.isWater = true;
            pd.paintColor = [...waterColor.rgb];
            // Asegurar que el país agua existe y está bloqueado
            if (!countries.has(waterHex)) {
                countries.set(waterHex, { name: "Agua", color: [...waterColor.rgb], flag: null, locked: true });
            } else {
                countries.get(waterHex).locked = true;
            }
        } else {
            pd.isWater = false;
            pd.paintColor = [...colorInicial];
            registerCountry(rgbToHex(pd.paintColor));
        }
        updateBaseMapColor(provinceId);
        addBorders();
        renderCountryList();
        renderFromBase();
    };

    CountryLockedEl.onchange = () => {
        if (!country) {
            console.log("[COUNTRY_LOCK_PANEL] Sin país para bloquear - hex:", hex);
            CountryLockedEl.checked = false;
            return;
        }
        country.locked = CountryLockedEl.checked;
        console.log("[COUNTRY_LOCK_PANEL] país:", hex, "locked:", country.locked, "provinciaId:", provinceId);
        // Si se bloquea el país Agua, el "Es agua" se disablea
        ProvinceIsWaterEl.disabled = country.locked;
        // Si se bloquearon todas las provincias de agua, el isWater se fuerza a true
        if (country.locked && hex === waterHex) {
            pd.isWater = true;
            ProvinceIsWaterEl.checked = true;
        }
        renderCountryList();
        renderFromBase();
    };

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
    CountryColorEl.onchange = () => {
        changeCountryColor(hex, CountryColorEl.value);
    };

    CountryLockedEl.onchange = () => {
        const c = countries.get(hex);
        if (!c) return;
        c.locked = CountryLockedEl.checked;
        console.log("[COUNTRY_LOCK_PANEL] país:", hex, "locked:", c.locked, "provinciaId:", provinceId);
        renderCountryList();
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
