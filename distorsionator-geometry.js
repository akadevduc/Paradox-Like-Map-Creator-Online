// distorsionator-geometry.js
//
// Convierte un mapa cónico en uno cilíndrico (rectangular): paralelos horizontales,
// meridianos verticales, ángulos de 90°.
//
// Idea (en un mapa cónico equidistante):
//   - los meridianos son rectas que se cruzan en un punto: el vértice del cono
//   - los paralelos son circunferencias con centro en ese vértice
// Entonces, para "desenrollar": la distancia al vértice (radio) pasa a ser la altura
// y el ángulo alrededor del vértice pasa a ser el ancho. La deformación es la misma
// en toda la imagen, no depende de zonas.

const MAX_LADO = 8192;        // tope del lado más largo de la imagen resultante
const MAX_PIXELES = 40e6;     // tope de píxeles totales (más que esto el navegador puede quedarse sin memoria)

// Recta que mejor pasa por los puntos (con 2 puntos pasa exacta por ambos)
function ajustarRecta(puntos) {
    let cx = 0, cy = 0;

    for (const p of puntos) {
        cx += p.x;
        cy += p.y;
    }

    cx /= puntos.length;
    cy /= puntos.length;

    let sxx = 0, sxy = 0, syy = 0;

    for (const p of puntos) {
        const dx = p.x - cx;
        const dy = p.y - cy;

        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
    }

    if (sxx + syy < 1e-8) return null;

    const angulo = 0.5 * Math.atan2(2 * sxy, sxx - syy);

    return { x: cx, y: cy, dx: Math.cos(angulo), dy: Math.sin(angulo) };
}

function interseccion(r1, r2) {
    const cruz = r1.dx * r2.dy - r1.dy * r2.dx;

    // seno del ángulo entre las rectas: casi 0 = casi paralelas
    if (Math.abs(cruz) < 1e-3) return null;

    const t = ((r2.x - r1.x) * r2.dy - (r2.y - r1.y) * r2.dx) / cruz;

    return { x: r1.x + t * r1.dx, y: r1.y + t * r1.dy };
}

// lineas = { meridianos: [[{x,y},...], [{x,y},...]], paralelos: [[{x,y},...], [{x,y},...]] }
// ancho/alto = tamaño de la imagen original en píxeles.
export function calcularCono(lineas, ancho, alto) {
    const { meridianos, paralelos } = lineas;

    if (meridianos.length !== 2 || meridianos.some(m => m.length < 2)) {
        throw new Error("Hacen falta 2 meridianos con al menos 2 puntos cada uno.");
    }

    if (!paralelos.some(p => p.length >= 1)) {
        throw new Error("Hace falta al menos un paralelo con algún punto.");
    }

    // 1) Vértice del cono = donde se cruzan los meridianos
    const r1 = ajustarRecta(meridianos[0]);
    const r2 = ajustarRecta(meridianos[1]);

    if (!r1 || !r2) {
        throw new Error("Los puntos de un meridiano están todos en el mismo lugar.");
    }

    const vertice = interseccion(r1, r2);

    if (!vertice) {
        throw new Error(
            "Los dos meridianos son casi paralelos: el mapa ya es cilíndrico, no hace falta desenrollarlo."
        );
    }

    if (vertice.x > 0 && vertice.x < ancho && vertice.y > 0 && vertice.y < alto) {
        throw new Error("El vértice del cono cae dentro de la imagen. Revisá los meridianos.");
    }

    // 2) Dirección del vértice hacia el mapa (promedio de todo lo marcado)
    const todos = [...meridianos.flat(), ...paralelos.flat()];
    let mx = 0, my = 0;

    for (const p of todos) {
        mx += p.x;
        my += p.y;
    }

    mx = mx / todos.length - vertice.x;
    my = my / todos.length - vertice.y;

    const largo = Math.hypot(mx, my);

    if (largo < 1e-6) {
        throw new Error("Los puntos marcados coinciden con el vértice del cono.");
    }

    const d0 = { x: mx / largo, y: my / largo };

    // El resultado queda "parado": si el vértice está arriba del mapa, arriba del resultado;
    // si está abajo (conos del hemisferio sur), abajo. Nunca se espeja.
    const abajo = d0.y < 0;
    const et = abajo ? { x: -d0.y, y: d0.x } : { x: d0.y, y: -d0.x };

    // 3) Radio de cada paralelo = distancia del vértice a sus puntos
    const infoParalelos = paralelos.map(pts => {
        if (pts.length < 1) return null;

        const radios = pts.map(p => Math.hypot(p.x - vertice.x, p.y - vertice.y));
        const radio = radios.reduce((a, b) => a + b, 0) / radios.length;
        const desvio = Math.max(...radios.map(r => Math.abs(r - radio)));

        return { radio, desvio, puntos: pts.length };
    });

    const usables = infoParalelos.filter(Boolean);
    const rhoRef = usables.reduce((a, p) => a + p.radio, 0) / usables.length;

    // 4) Qué rango de radios y ángulos ocupa la imagen (se recorre su borde)
    let rhoMin = Infinity, rhoMax = -Infinity, thMin = Infinity, thMax = -Infinity;

    const probar = (x, y) => {
        const vx = x - vertice.x;
        const vy = y - vertice.y;
        const rho = Math.hypot(vx, vy);
        const th = Math.atan2(vx * et.x + vy * et.y, vx * d0.x + vy * d0.y);

        if (rho < rhoMin) rhoMin = rho;
        if (rho > rhoMax) rhoMax = rho;
        if (th < thMin) thMin = th;
        if (th > thMax) thMax = th;
    };

    const N = 400;

    for (let i = 0; i <= N; i++) {
        const t = i / N;

        probar(t * ancho, 0);
        probar(t * ancho, alto);
        probar(0, t * alto);
        probar(ancho, t * alto);
    }

    // 5) Tamaño de la imagen resultante: a escala real sobre el radio de referencia
    const anchoReal = (thMax - thMin) * rhoRef;
    const altoReal = rhoMax - rhoMin;

    if (!(anchoReal > 0) || !(altoReal > 0)) {
        throw new Error("No se pudo calcular el tamaño del resultado.");
    }

    const k = Math.min(
        1,
        MAX_LADO / Math.max(anchoReal, altoReal),
        Math.sqrt(MAX_PIXELES / (anchoReal * altoReal))
    );

    return {
        vertice, d0, et, abajo,
        rhoRef, rhoMin, rhoMax, thMin, thMax,
        paralelos: infoParalelos,
        k,
        W: Math.max(1, Math.round(anchoReal * k)),
        H: Math.max(1, Math.round(altoReal * k))
    };
}

// Genera los píxeles del resultado. Recorre cada píxel de SALIDA y busca de dónde sale en la imagen original.
// src = datos RGBA de la imagen original (sw × sh).
export function renderizarCono(cono, src, sw, sh) {
    const { vertice, d0, et, abajo, rhoRef, rhoMin, rhoMax, thMin, k, W, H } = cono;
    const salida = new Uint8ClampedArray(W * H * 4);

    const cos = new Float64Array(W);
    const sen = new Float64Array(W);

    for (let i = 0; i < W; i++) {
        const th = thMin + ((i + 0.5) / k) / rhoRef;
        cos[i] = Math.cos(th);
        sen[i] = Math.sin(th);
    }

    for (let j = 0; j < H; j++) {
        const v = (j + 0.5) / k;
        const rho = abajo ? rhoMax - v : rhoMin + v;

        for (let i = 0; i < W; i++) {
            const sx = vertice.x + rho * (cos[i] * d0.x + sen[i] * et.x);
            const sy = vertice.y + rho * (cos[i] * d0.y + sen[i] * et.y);

            if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;

            // interpolación bilineal
            const x = sx - 0.5;
            const y = sy - 0.5;

            let x0 = Math.floor(x);
            let y0 = Math.floor(y);

            const fx = x - x0;
            const fy = y - y0;

            let x1 = x0 + 1;
            let y1 = y0 + 1;

            if (x0 < 0) x0 = 0;
            if (y0 < 0) y0 = 0;
            if (x1 > sw - 1) x1 = sw - 1;
            if (y1 > sh - 1) y1 = sh - 1;

            const i00 = (y0 * sw + x0) * 4;
            const i10 = (y0 * sw + x1) * 4;
            const i01 = (y1 * sw + x0) * 4;
            const i11 = (y1 * sw + x1) * 4;

            const w00 = (1 - fx) * (1 - fy);
            const w10 = fx * (1 - fy);
            const w01 = (1 - fx) * fy;
            const w11 = fx * fy;

            const d = (j * W + i) * 4;

            for (let c = 0; c < 4; c++) {
                salida[d + c] =
                    src[i00 + c] * w00 + src[i10 + c] * w10 +
                    src[i01 + c] * w01 + src[i11 + c] * w11;
            }
        }
    }

    return salida;
}

// Dónde cae un punto de la imagen ORIGINAL dentro de la imagen resultante (en píxeles del resultado).
export function proyectarPunto(cono, x, y) {
    const vx = x - cono.vertice.x;
    const vy = y - cono.vertice.y;
    const rho = Math.hypot(vx, vy);
    const th = Math.atan2(
        vx * cono.et.x + vy * cono.et.y,
        vx * cono.d0.x + vy * cono.d0.y
    );

    return {
        x: (th - cono.thMin) * cono.rhoRef * cono.k,
        y: (cono.abajo ? cono.rhoMax - rho : rho - cono.rhoMin) * cono.k
    };
}

// Mejor recta  destino = escala · origen + desplazamiento  por mínimos cuadrados (un solo eje)
function ajustarEje(origen, destino) {
    const n = origen.length;
    const mo = origen.reduce((a, b) => a + b, 0) / n;
    const md = destino.reduce((a, b) => a + b, 0) / n;

    let soo = 0, sod = 0;

    for (let i = 0; i < n; i++) {
        soo += (origen[i] - mo) * (origen[i] - mo);
        sod += (origen[i] - mo) * (destino[i] - md);
    }

    if (soo < 1e-6) return null;   // todos los puntos en la misma columna/fila: el eje no queda determinado

    const escala = sod / soo;

    return { escala, desplazamiento: md - escala * mo };
}

// pares: [{ from: {x, y} (en el resultado), to: {x, y} (en la pantalla) }]
// Calcula cómo estirar y mover el resultado para que cada punto caiga sobre su pareja en el mapa.
// Ancho y alto se escalan por separado (el resultado cilíndrico no tiene por qué ser equirrectangular).
export function ajustarEscala(pares) {
    if (pares.length < 2) {
        throw new Error(
            "Para colocar la imagen en el mapa hacen falta al menos 2 puntos marcados en la imagen y en el mapa."
        );
    }

    const ex = ajustarEje(pares.map(p => p.from.x), pares.map(p => p.to.x));
    const ey = ajustarEje(pares.map(p => p.from.y), pares.map(p => p.to.y));

    if (!ex && !ey) {
        throw new Error("Los puntos marcados caen todos en el mismo lugar del resultado.");
    }

    // si un eje no queda determinado (p. ej. todos los puntos sobre el mismo paralelo), usa la escala del otro
    const sx = ex ? ex.escala : ey.escala;
    const sy = ey ? ey.escala : ex.escala;

    if (!(sx > 0) || !(sy > 0)) {
        throw new Error(
            "Los puntos del mapa quedan espejados respecto a la imagen. Revisá que cada pareja sea el mismo lugar."
        );
    }

    const media = (lista, f) => lista.reduce((a, p) => a + f(p), 0) / lista.length;

    const tx = ex ? ex.desplazamiento : media(pares, p => p.to.x) - sx * media(pares, p => p.from.x);
    const ty = ey ? ey.desplazamiento : media(pares, p => p.to.y) - sy * media(pares, p => p.from.y);

    // cuánto fallan las parejas con este ajuste (en píxeles de pantalla)
    let suma = 0;

    for (const p of pares) {
        const dx = sx * p.from.x + tx - p.to.x;
        const dy = sy * p.from.y + ty - p.to.y;
        suma += dx * dx + dy * dy;
    }

    return { sx, sy, tx, ty, residuo: Math.sqrt(suma / pares.length) };
}

// Lo que llama el panel: recibe la imagen (elemento <img>) y las líneas marcadas.
export function desenrollarCono(image, lineas) {
    if (!image.complete || !image.naturalWidth) {
        throw new Error("La imagen original no está cargada.");
    }

    const sw = image.naturalWidth;
    const sh = image.naturalHeight;

    const cono = calcularCono(lineas, sw, sh);

    const origen = document.createElement("canvas");
    origen.width = sw;
    origen.height = sh;

    const origenCtx = origen.getContext("2d", { willReadFrequently: true });
    origenCtx.drawImage(image, 0, 0);

    const datos = origenCtx.getImageData(0, 0, sw, sh).data;
    const pixeles = renderizarCono(cono, datos, sw, sh);

    const canvas = document.createElement("canvas");
    canvas.width = cono.W;
    canvas.height = cono.H;

    canvas.getContext("2d").putImageData(
        new ImageData(pixeles, cono.W, cono.H), 0, 0
    );

    return { canvas, ...cono };
}