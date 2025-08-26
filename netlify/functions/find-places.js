// netlify/functions/find-places.js
const https = require("https");
const { URLSearchParams } = require("url");

// Environment variables
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GPS_ANCHOR = process.env.GPS_ANCHOR || "PIK Jakarta Utara, Indonesia";

// Helper function to make HTTPS requests
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error("Invalid JSON response"));
          }
        });
      })
      .on("error", (error) => {
        reject(error);
      });
  });
}

// Function to get coordinates for a location
async function getCoordinates(location) {
  try {
    const baseUrl = "https://maps.googleapis.com/maps/api/geocode/json";
    const params = new URLSearchParams({
      address: location,
      key: GOOGLE_MAPS_API_KEY,
    });

    const url = `${baseUrl}?${params}`;
    const result = await makeRequest(url);

    if (result.status === "OK" && result.results.length > 0) {
      const coords = result.results[0].geometry.location;
      return { lat: coords.lat, lng: coords.lng };
    } else {
      throw new Error(`Geocoding failed for: ${location}`);
    }
  } catch (error) {
    console.error("Geocoding error:", error);
    throw error;
  }
}

// Function to calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Function to get all places with location bias
async function getAllPlaces(query, anchorCoords, maxResults = 60) {
  const allPlaces = [];
  let nextPageToken = null;
  let requestsMade = 0;
  const maxRequests = 3;

  try {
    while (requestsMade < maxRequests && allPlaces.length < maxResults) {
      const baseUrl =
        "https://maps.googleapis.com/maps/api/place/textsearch/json";
      const params = new URLSearchParams({
        query: query,
        key: GOOGLE_MAPS_API_KEY,
      });

      // Add location bias to prioritize results near anchor point
      if (anchorCoords) {
        params.append("location", `${anchorCoords.lat},${anchorCoords.lng}`);
        params.append("radius", "50000"); // 50km radius
      }

      if (nextPageToken) {
        params.append("pagetoken", nextPageToken);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      const url = `${baseUrl}?${params}`;
      const result = await makeRequest(url);
      requestsMade++;

      if (result.status !== "OK" && result.status !== "ZERO_RESULTS") {
        break;
      }

      const currentResults = result.results || [];
      allPlaces.push(...currentResults);

      nextPageToken = result.next_page_token;

      if (!nextPageToken || allPlaces.length >= maxResults) {
        break;
      }
    }
  } catch (error) {
    console.error("Error fetching additional pages:", error);
  }

  return allPlaces.slice(0, maxResults);
}

// Format place info with distance
function formatPlaceInfo(place, anchorCoords) {
  const placeId = place.place_id;
  const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=place_id:${placeId}`;
  const directionUrl = `https://www.google.com/maps/dir/?api=1&destination_place_id=${placeId}&destination=${encodeURIComponent(place.formatted_address || "")}`;

  const placeInfo = {
    name: place.name,
    address: place.formatted_address,
    rating: place.rating,
    place_id: placeId,
    maps_embed_url: embedUrl,
    maps_direction_url: directionUrl,
    distance_km: null,
  };

  // Calculate distance if coordinates are available
  if (anchorCoords && place.geometry && place.geometry.location) {
    const distance = calculateDistance(
      anchorCoords.lat,
      anchorCoords.lng,
      place.geometry.location.lat,
      place.geometry.location.lng,
    );
    placeInfo.distance_km = Math.round(distance * 100) / 100; // Round to 2 decimal places
  }

  return placeInfo;
}

// Calculate pagination
function calculatePagination(totalResults, topN, currentPage) {
  const totalPages = Math.ceil(totalResults / topN);

  return {
    current_page: currentPage,
    total_results: totalResults,
    results_per_page: topN,
    total_pages: totalPages,
    has_next_page: currentPage < totalPages,
    has_prev_page: currentPage > 1,
  };
}

// Main search function
async function searchPlaces(query, topN = 5, page = 1) {
  console.log(`Searching for: ${query} (top_n: ${topN}, page: ${page})`);

  if (topN < 1 || topN > 60) {
    throw new Error("top_n must be between 1 and 60");
  }
  if (page < 1) {
    throw new Error("page must be 1 or greater");
  }

  try {
    // Get anchor coordinates
    const anchorCoords = await getCoordinates(GPS_ANCHOR);
    console.log(`Anchor coordinates for ${GPS_ANCHOR}:`, anchorCoords);

    // Get all places
    const allPlaces = await getAllPlaces(query, anchorCoords, 60);

    if (allPlaces.length === 0) {
      return {
        status: "ZERO_RESULTS",
        results: [],
        pagination: calculatePagination(0, topN, page),
        anchor_location: GPS_ANCHOR,
      };
    }

    // Format places with distance calculation
    const formattedPlaces = allPlaces.map((place) =>
      formatPlaceInfo(place, anchorCoords),
    );

    // Sort by distance (closest first), then by rating (highest first)
    formattedPlaces.sort((a, b) => {
      if (a.distance_km !== null && b.distance_km !== null) {
        if (Math.abs(a.distance_km - b.distance_km) < 0.5) {
          // If distances are very similar (within 500m), sort by rating
          return (b.rating || 0) - (a.rating || 0);
        }
        return a.distance_km - b.distance_km;
      }
      if (a.distance_km !== null) return -1;
      if (b.distance_km !== null) return 1;
      return (b.rating || 0) - (a.rating || 0);
    });

    // Calculate pagination
    const totalResults = formattedPlaces.length;
    const totalPages = Math.ceil(totalResults / topN);
    const startIdx = (page - 1) * topN;
    const endIdx = Math.min(startIdx + topN, totalResults);

    if (startIdx >= totalResults) {
      throw new Error(
        `Page ${page} not found. Total pages available: ${totalPages}`,
      );
    }

    const pagePlaces = formattedPlaces.slice(startIdx, endIdx);

    return {
      status: "OK",
      results: pagePlaces,
      pagination: calculatePagination(totalResults, topN, page),
      anchor_location: GPS_ANCHOR,
    };
  } catch (error) {
    console.error("Search error:", error);
    throw error;
  }
}

// Netlify function handler
exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Google Maps API key not configured" }),
    };
  }

  try {
    const requestBody = JSON.parse(event.body);
    const { query, top_n = 5, page = 1 } = requestBody;

    if (!query || query.trim() === "") {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Query parameter is required" }),
      };
    }

    const result = await searchPlaces(query.trim(), top_n, page);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error("Function error:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal server error",
        detail: error.message,
      }),
    };
  }
};
