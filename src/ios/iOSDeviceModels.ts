/**
 * Map iOS ProductType identifiers to human-readable model names
 * Source: https://www.theiphonewiki.com/wiki/Models
 */
export const IOS_DEVICE_MODELS: Record<string, string> = {
  // iPhone 16 series (2024)
  'iPhone17,1': 'iPhone 16 Pro',
  'iPhone17,2': 'iPhone 16 Pro Max',
  'iPhone17,3': 'iPhone 16',
  'iPhone17,4': 'iPhone 16 Plus',

  // iPhone 15 series (2023)
  'iPhone16,1': 'iPhone 15 Pro',
  'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone15,4': 'iPhone 15',
  'iPhone15,5': 'iPhone 15 Plus',

  // iPhone 14 series (2022)
  'iPhone15,2': 'iPhone 14 Pro',
  'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone14,7': 'iPhone 14',
  'iPhone14,8': 'iPhone 14 Plus',

  // iPhone 13 series (2021)
  'iPhone14,2': 'iPhone 13 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,5': 'iPhone 13',
  'iPhone14,4': 'iPhone 13 mini',

  // iPhone 12 series (2020)
  'iPhone13,1': 'iPhone 12 mini',
  'iPhone13,2': 'iPhone 12',
  'iPhone13,3': 'iPhone 12 Pro',
  'iPhone13,4': 'iPhone 12 Pro Max',

  // iPhone 11 series (2019)
  'iPhone12,1': 'iPhone 11',
  'iPhone12,3': 'iPhone 11 Pro',
  'iPhone12,5': 'iPhone 11 Pro Max',

  // iPhone SE
  'iPhone14,6': 'iPhone SE (3rd gen)',
  'iPhone12,8': 'iPhone SE (2nd gen)',

  // iPhone XS/XR (2018)
  'iPhone11,2': 'iPhone XS',
  'iPhone11,4': 'iPhone XS Max',
  'iPhone11,6': 'iPhone XS Max',
  'iPhone11,8': 'iPhone XR',

  // iPhone X/8 (2017)
  'iPhone10,3': 'iPhone X',
  'iPhone10,6': 'iPhone X',
  'iPhone10,1': 'iPhone 8',
  'iPhone10,4': 'iPhone 8',
  'iPhone10,2': 'iPhone 8 Plus',
  'iPhone10,5': 'iPhone 8 Plus',

  // iPad Pro (M4, 2024)
  'iPad16,3': 'iPad Pro 11" (M4)',
  'iPad16,4': 'iPad Pro 11" (M4)',
  'iPad16,5': 'iPad Pro 13" (M4)',
  'iPad16,6': 'iPad Pro 13" (M4)',

  // iPad Pro (M2, 2022)
  'iPad14,3': 'iPad Pro 11" (4th gen)',
  'iPad14,4': 'iPad Pro 11" (4th gen)',
  'iPad14,5': 'iPad Pro 12.9" (6th gen)',
  'iPad14,6': 'iPad Pro 12.9" (6th gen)',

  // iPad Pro (M1, 2021)
  'iPad13,4': 'iPad Pro 11" (3rd gen)',
  'iPad13,5': 'iPad Pro 11" (3rd gen)',
  'iPad13,6': 'iPad Pro 11" (3rd gen)',
  'iPad13,7': 'iPad Pro 11" (3rd gen)',
  'iPad13,8': 'iPad Pro 12.9" (5th gen)',
  'iPad13,9': 'iPad Pro 12.9" (5th gen)',
  'iPad13,10': 'iPad Pro 12.9" (5th gen)',
  'iPad13,11': 'iPad Pro 12.9" (5th gen)',

  // iPad Air
  'iPad14,8': 'iPad Air 11" (M2)',
  'iPad14,9': 'iPad Air 11" (M2)',
  'iPad14,10': 'iPad Air 13" (M2)',
  'iPad14,11': 'iPad Air 13" (M2)',
  'iPad13,16': 'iPad Air (5th gen)',
  'iPad13,17': 'iPad Air (5th gen)',
  'iPad13,1': 'iPad Air (4th gen)',
  'iPad13,2': 'iPad Air (4th gen)',

  // iPad mini
  'iPad14,1': 'iPad mini (6th gen)',
  'iPad14,2': 'iPad mini (6th gen)',
  'iPad11,1': 'iPad mini (5th gen)',
  'iPad11,2': 'iPad mini (5th gen)',

  // iPad (standard)
  'iPad14,12': 'iPad (A16)',
  'iPad13,18': 'iPad (10th gen)',
  'iPad13,19': 'iPad (10th gen)',
  'iPad12,1': 'iPad (9th gen)',
  'iPad12,2': 'iPad (9th gen)',
  'iPad11,6': 'iPad (8th gen)',
  'iPad11,7': 'iPad (8th gen)',
};

/**
 * Map a ProductType identifier to a human-readable model name
 * @param productType The ProductType identifier (e.g., "iPhone16,2")
 * @returns The human-readable model name, or null if not found
 */
export function mapIOSProductType(productType: string): string | null {
  return IOS_DEVICE_MODELS[productType] || null;
}
