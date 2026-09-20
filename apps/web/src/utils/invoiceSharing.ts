function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/\D/g, '');
}

export function normalizeWhatsAppPhone(value: string, countryCode = ''): string {
  let digits = normalizeDigits(value);
  const explicitCountryCode = normalizeDigits(countryCode);

  // Handle 00 international prefix
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Handle + international prefix
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }

  // If an explicit country code is provided, use it with the local number
  if (explicitCountryCode) {
    // Remove leading zero from local number (common in national formats)
    const localDigits = digits.replace(/^0+/, '');
    return `${explicitCountryCode}${localDigits}`;
  }

  // If no country code provided, return digits as-is
  // (caller should ensure this is already international format)
  return digits;
}

export function isValidWhatsAppPhone(value: string): boolean {
  return /^\d{8,15}$/.test(value);
}

export function canShareInvoiceFile(file: globalThis.File): boolean {
  const shareNavigator = navigator as globalThis.Navigator & {
    canShare?: (data?: globalThis.ShareData) => boolean;
  };

  return typeof navigator.share === 'function'
    && typeof shareNavigator.canShare === 'function'
    && shareNavigator.canShare({ files: [file] });
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
