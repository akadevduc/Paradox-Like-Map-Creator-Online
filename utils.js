export function scale(point, multiplier) {
    return {
        x: point.x * multiplier,
        y: point.y * multiplier
    };
}