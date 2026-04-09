export function getAutoDieselPrice(stop) {
  if (stop?.auto_diesel_price === null || stop?.auto_diesel_price === undefined || stop?.auto_diesel_price === "") {
    return null;
  }

  const price = Number(stop.auto_diesel_price);
  return Number.isFinite(price) ? price : null;
}

export function parsePriceTarget(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const target = Number(value);
  return Number.isFinite(target) && target > 0 ? target : null;
}

export function formatPriceTarget(value) {
  const target = typeof value === "number" ? value : parsePriceTarget(value);
  return target === null ? "" : `$${target.toFixed(3)}`;
}

export function getPriceSignalMeta(stop, priceTarget) {
  const target = typeof priceTarget === "number" ? priceTarget : parsePriceTarget(priceTarget);
  if (target === null) {
    return { target: null, signal: "neutral", label: "", summary: "" };
  }

  const price = getAutoDieselPrice(stop);
  if (price === null) {
    return {
      target,
      signal: "unknown",
      label: "No price",
      summary: `No published auto diesel price vs ${formatPriceTarget(target)} target`
    };
  }

  const delta = Math.abs(price - target).toFixed(3);
  if (price <= target) {
    return {
      target,
      signal: "below",
      label: "Below target",
      summary: `-${delta} vs ${formatPriceTarget(target)} target`
    };
  }

  return {
    target,
    signal: "above",
    label: "Above target",
    summary: `+${delta} vs ${formatPriceTarget(target)} target`
  };
}

export function getPriceSignalClass(signal) {
  if (signal === "below") return "price-below-target";
  if (signal === "above") return "price-above-target";
  if (signal === "unknown") return "price-unknown-target";
  return "";
}
