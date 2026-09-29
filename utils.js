export function scale(point, multiplier) {
    return {
        x: point.x * multiplier,
        y: point.y * multiplier
    };
}

// =======================
// TIMING UTILITIES
// =======================
const _t0 = {};
export function timerStart(name) {
    (_t0[name] ??= []).push(performance.now());
}
export function timerEnd(name) {
    const stack = _t0[name];
    if (!stack || stack.length === 0) {
        console.warn(`[PERF] timerEnd("${name}") llamado sin timerStart correspondiente`);
        return;
    }
    const start = stack.pop();
    const ms = performance.now() - start;
    if (ms > 2) console.log(`[PERF] ${name}: ${ms.toFixed(2)}ms`);
}

// =======================
// MEMORY REPORTING
// =======================
// Trackea la memoria consumida por cada operación principal.
// Usa performance.memory si está disponible (Chrome), sino muestra un estimado.
let _lastMemReport = 0;
const _memOps = {};

export function memoryReport(operation = "", force = false) {
    // Solo mostrar en Chrome con performance.memory disponible
    if (typeof performance === "undefined" || !performance.memory) return;
    // Throttle: máximo una vez cada 500ms
    const now = performance.now();
    if (!force && now - _lastMemReport < 500) return;
    _lastMemReport = now;

    const mem = performance.memory;
    const usedMB = (mem.usedJSHeapSize / 1048576).toFixed(1);
    const totalMB = (mem.totalJSHeapSize / 1048576).toFixed(1);
    const limitMB = (mem.jsHeapSizeLimit / 1048576).toFixed(0);
    console.log(`[MEM] ${operation || "operación"}: ${usedMB}MB usados / ${totalMB}MB total / límite ${limitMB}MB`);
}

export function memoryStart(operation) {
    _memOps[operation] = { start: performance.now(), mem: performance.memory?.usedJSHeapSize || 0 };
}

export function memoryEnd(operation) {
    if (!_memOps[operation]) return;
    const info = _memOps[operation];
    const ms = performance.now() - info.start;
    const memNow = performance.memory?.usedJSHeapSize || 0;
    const deltaMB = ((memNow - info.mem) / 1048576).toFixed(1);
    console.log(`[MEM+PERF] ${operation}: ${ms.toFixed(2)}ms, memoria delta: ${deltaMB}MB`);
    delete _memOps[operation];
}