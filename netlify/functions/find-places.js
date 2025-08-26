// netlify/functions/find-places.js
const https = require("https");
const { URLSearchParams } = require("url");

// Environment variables (set in Netlify dashboard)
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

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

// Function to get all places (similar to Python version)
async function getAllPlaces(query, maxResults = 60) {
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

      if (nextPageToken) {
        params.append("pagetoken", nextPageToken);
        // Wait 2 seconds for next page token
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

// Format place info (similar to Python version)
function formatPlaceInfo(place) {
  const placeId = place.place_id;
  const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=place_id:${placeId}`;
  const directionUrl = `https://www.google.com/maps/dir/?api=1&destination_place_id=${placeId}&destination=${encodeURIComponent(place.formatted_address || "")}`;

  return {
    name: place.name,
    address: place.formatted_address,
    rating: place.rating,
    place_id: placeId,
    maps_embed_url: embedUrl,
    maps_direction_url: directionUrl,
  };
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

  // Validate parameters
  if (topN < 1 || topN > 60) {
    throw new Error("top_n must be between 1 and 60");
  }
  if (page < 1) {
    throw new Error("page must be 1 or greater");
  }

  try {
    // Get all available places
    const allPlaces = await getAllPlaces(query, 60);

    if (allPlaces.length === 0) {
      return {
        status: "ZERO_RESULTS",
        results: [],
        pagination: calculatePagination(0, topN, page),
      };
    }

    // Calculate pagination
    const totalResults = allPlaces.length;
    const totalPages = Math.ceil(totalResults / topN);
    const startIdx = (page - 1) * topN;
    const endIdx = Math.min(startIdx + topN, totalResults);

    // Check if requested page exists
    if (startIdx >= totalResults) {
      throw new Error(
        `Page ${page} not found. Total pages available: ${totalPages}`,
      );
    }

    // Get places for current page
    const pagePlaces = allPlaces.slice(startIdx, endIdx);
    const formattedResults = pagePlaces.map((place) => formatPlaceInfo(place));

    return {
      status: "OK",
      results: formattedResults,
      pagination: calculatePagination(totalResults, topN, page),
    };
  } catch (error) {
    console.error("Search error:", error);
    throw error;
  }
}

// Netlify function handler
exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle OPTIONS request (preflight)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: "",
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Check if API key is configured
  if (!GOOGLE_MAPS_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Google Maps API key not configured" }),
    };
  }

  try {
    // Parse request body
    const requestBody = JSON.parse(event.body);
    const { query, top_n = 5, page = 1 } = requestBody;

    if (!query || query.trim() === "") {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Query parameter is required" }),
      };
    }

    // Search places
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
