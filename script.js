const forcedUnavailable = new Set([
  "Falkland Islands",
  "Greenland",
  "French Guiana",
  "New Caledonia"
]);

const forcedUnavailableNormalized = new Set(
  [...forcedUnavailable].map((s) => String(s).trim())
);

/** Natural Earth (and similar) labels → canonical name in `forcedUnavailable`. */
const forcedUnavailableLabelAliases = {
  "Falkland Is.": "Falkland Islands",
};

function normalizedForcedLabel(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (forcedUnavailableNormalized.has(t)) return t;
  const mapped = forcedUnavailableLabelAliases[t];
  if (mapped && forcedUnavailableNormalized.has(mapped)) return mapped;
  return null;
}

/** True if this feature should stay unavailable (red) regardless of parent country availability. */
function isForcedUnavailableFeature(d) {
  const p = d.properties || {};
  const candidates = [
    p.ADMIN,
    p.NAME,
    p.NAME_LONG,
    p.name,
    p.SUBUNIT,
    p.GEOUNIT,
    p.BRK_NAME,
  ].filter(Boolean);

  for (const c of candidates) {
    if (normalizedForcedLabel(c)) return true;
  }
  return false;
}

const availableCountries = {
"Australia": "Yes",
"Austria": "Yes",
"Belgium": "Yes",
"Bulgaria": "Yes",
"Canada": "Yes",
"Croatia": "Yes",
"Cyprus": "Yes",
"Czech Republic": "Yes"  ,
"Denmark": "Yes",
"Estonia": "Yes",
"Finland": "Yes",
"France": "Yes",
"Germany": "Yes",
"Greece": "Yes",
"Hong Kong": "(through Komodo)",
"Hungary": "Yes",
"Ireland": "Yes",
"Italy": "Yes",
"Japan": "(through Komodo)",
"Latvia": "Yes",
"Lithuania": "Yes",
"Poland": "Yes",
"Portugal": "Yes",
"Romania": "Yes",
"Slovakia": "Yes",
"Slovenia": "Yes",
"South Korea" : "(through Komodo)",
"Spain": "Yes",
"Sweden": "Yes",
"Taiwan": "(through Komodo)",
"United Kingdom": "Yes",
"United States of America": "Yes, but APO/FPO addresses are not supported currently",
};

const availableCountryNames = new Set(
  Object.keys(availableCountries).map((k) => k.trim())
);

/** GeoJSON names that differ from keys in `availableCountries`. */
const countryNameAliases = {
  "United States": "United States of America",
  "Korea, Republic of": "South Korea",
  "Korea, South": "South Korea",
  "Czechia": "Czech Republic",
};

function resolveAvailabilityKey(rawName) {
  if (!rawName) return null;
  const trimmed = String(rawName).trim();
  if (availableCountryNames.has(trimmed)) return trimmed;
  const aliasTarget = countryNameAliases[trimmed];
  if (aliasTarget && availableCountryNames.has(aliasTarget)) return aliasTarget;
  return null;
}

function isCountryAvailable(d) {
  if (isForcedUnavailableFeature(d)) return false;

  const p = d.properties || {};

  const candidates = [
    p.ADMIN,
    p.NAME,
    p.NAME_LONG,
    p.name,
    p.SOVEREIGNT,
  ].filter(Boolean);

  for (const c of candidates) {
    const key = resolveAvailabilityKey(c);

    if (key) {
      if (forcedUnavailableNormalized.has(key)) return false;
      return true;
    }
  }

  return false;
}

function splitFranceFrenchGuiana(features) {
  const result = [];
  for (const f of features) {
    const p = f.properties || {};
    if (p.ADM0_A3 !== "FRA" || f.geometry?.type !== "MultiPolygon") {
      result.push(f);
      continue;
    }
    const mp = f.geometry.coordinates;
    let guyanaIdx = -1;
    for (let i = 0; i < mp.length; i++) {
      const ring = mp[i][0];
      if (!ring?.length) continue;
      let sx = 0;
      let sy = 0;
      for (const [lon, lat] of ring) {
        sx += lon;
        sy += lat;
      }
      const cx = sx / ring.length;
      const cy = sy / ring.length;
      if (cx < -40 && cy > -8 && cy < 14) {
        guyanaIdx = i;
        break;
      }
    }
    if (guyanaIdx === -1) {
      result.push(f);
      continue;
    }
    const guyanaPoly = mp[guyanaIdx];
    const rest = mp.filter((_, j) => j !== guyanaIdx);
    const base = f.properties || {};
    result.push({
      type: "Feature",
      properties: {
        ...base,
        ADMIN: "French Guiana",
        NAME: "French Guiana",
        NAME_LONG: "French Guiana",
        SOVEREIGNT: "France",
        ADM0_A3: "GUF",
      },
      geometry: { type: "Polygon", coordinates: guyanaPoly },
    });
    result.push({
      type: "Feature",
      properties: { ...base },
      geometry:
        rest.length === 1
          ? { type: "Polygon", coordinates: rest[0] }
          : { type: "MultiPolygon", coordinates: rest },
    });
  }
  return result;
}

(async function () {
    const wrap = document.getElementById("map-wrap");
    const tooltip = document.getElementById("tooltip");
    const statusEl = document.getElementById("status");

    const geoUrl =
      "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson";

    let data;
    try {
      data = await d3.json(geoUrl);
    } catch (e) {
      statusEl.textContent =
        "Unable to load map (network or CORS issue). Check your internet connection.";
      console.error(e);
      return;
    }

    data.features = splitFranceFrenchGuiana(data.features);

    const width = wrap.clientWidth;
    const height = wrap.clientHeight;

    const svg = d3
      .select(wrap)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const projection = d3.geoNaturalEarth1().fitExtent(
      [
        [2, 2],
        [width - 2, height - 2],
      ],
      data
    );
    const path = d3.geoPath(projection);

    function countryName(d) {
      const p = d.properties || {};
      return (
        p.ADMIN ||
        p.NAME ||
        p.name ||
        p.NAME_LONG ||
        "—"
      );
    }

    svg
      .append("g")
      .selectAll("path")
      .data(data.features)
      .join("path")
      .attr("class", (d) =>
        isCountryAvailable(d) ? "country country-available" : "country country-unavailable"
      )
      .attr("d", path)
      .on("mousemove", function (event, d) {
        const rect = wrap.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        tooltip.textContent = availableCountries[countryName(d)]?? "No.";
        tooltip.classList.add("visible");
        tooltip.style.left = x + "px";
        tooltip.style.top = y + "px";
      })
      .on("mouseleave", function () {
        tooltip.classList.remove("visible");
      });

    statusEl.innerHTML =
      data.features.length + " countries/territories — data from <a style='color: white;' href='https://www.naturalearthdata.com/'>Natural Earth</a>.";
  })();