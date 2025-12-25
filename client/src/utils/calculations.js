/**
 * Rounds a value to the nearest 0.5 according to specific rules:
 * - If decimal part >= 0.1, round UP to nearest X.5 or X.0
 * - If decimal part < 0.1, round DOWN to nearest X.5 or X.0
 * 
 * Logic implemented as:
 * - decimal >= 0.1 -> Math.ceil(value * 2) / 2
 * - decimal < 0.1 -> Math.floor(value * 2) / 2
 */
function roundToHalfWithRule(value) {
    const decimalPart = value - Math.floor(value);

    if (decimalPart >= 0.1) {
        // Roof (ceil) to nearest 0.5
        return Math.ceil(value * 2) / 2;
    } else {
        // Floor to nearest 0.5
        return Math.floor(value * 2) / 2;
    }
}

/**
 * Converts Millimeters to Square Feet using custom conversion factor and rounding rules.
 * @param {number} lengthMm 
 * @param {number} widthMm 
 * @returns {number} Area in Square Feet
 */
export function mmToSquareFeet(lengthMm, widthMm) {
    const MM_TO_FEET = 304.79999025;

    // Convert mm to feet
    const lengthFeet = lengthMm / MM_TO_FEET;
    const widthFeet = widthMm / MM_TO_FEET;

    // Apply rounding rule
    const roundedLength = roundToHalfWithRule(lengthFeet);
    const roundedWidth = roundToHalfWithRule(widthFeet);

    // Square feet
    return roundedLength * roundedWidth;
}

/**
 * Converts Inches to Square Feet using standard conversion (12 in = 1 ft) and custom rounding rules.
 * @param {number} lengthInch 
 * @param {number} widthInch 
 * @returns {number} Area in Square Feet
 */
export function inchesToSquareFeet(lengthInch, widthInch) {
    const INCHES_TO_FEET = 12;

    // Convert inches to feet
    const lengthFeet = lengthInch / INCHES_TO_FEET;
    const widthFeet = widthInch / INCHES_TO_FEET;

    // Apply rounding rule
    const roundedLength = roundToHalfWithRule(lengthFeet);
    const roundedWidth = roundToHalfWithRule(widthFeet);

    // Return square feet
    return roundedLength * roundedWidth;
}
