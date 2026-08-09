const ALLOWED_SCHEMES = Object.freeze(["http:", "https:"]);

const isAllowedUrl = (url) => {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;

  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
};

module.exports = { isAllowedUrl };
