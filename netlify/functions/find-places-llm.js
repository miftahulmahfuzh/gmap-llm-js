// netlify/functions/find-places-llm.js
const https = require("https");
const { URLSearchParams } = require("url");

// Environment variables
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const SYSTEM_PROMPT = `You are an expert query optimizer for Google Maps Places API searches. Your job is to transform user queries into the most effective search terms for finding places.

Guidelines:
1. Focus on the core intent - what type of place/business they want
2. Include location if mentioned, otherwise keep it general
3. Use common business/place terminology that Google Maps recognizes
4. Remove unnecessary words and conversational elements
5. Make it concise but specific
6. If they mention a specific location, include it
7. Transform informal descriptions into proper business categories

Examples:
"I'm looking for a good pizza place in Manhattan" → "pizza restaurant Manhattan"
"Where can I get my car fixed near me?" → "car repair shop"
"best coffee in Seattle" → "coffee shop Seattle"
"I need to find a pharmacy that's open late" → "24 hour pharmacy"
"good sushi restaurant recommendations in Tokyo" → "sushi restaurant Tokyo"

Return only the optimized search query, nothing else.`;

// Helper function to make HTTPS requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
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
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// Function to preprocess query with LLM
async function preprocessQueryWithLLM(userQuery) {
  try {
    const url = "https://api.deepseek.com/chat/completions";
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userQuery },
        ],
        stream: false,
      }),
    };

    const response = await makeRequest(url, options);
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("LLM preprocessing error:", error);
    // Fallback to original query if LLM fails
    return userQuery;
  }
}

// Function to get all places
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

// Format place info
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

  if (topN < 1 || topN > 60) {
    throw new Error("top_n must be between 1 and 60");
  }
  if (page < 1) {
    throw new Error("page must be 1 or greater");
  }

  try {
    const allPlaces = await getAllPlaces(query, 60);

    if (allPlaces.length === 0) {
      return {
        status: "ZERO_RESULTS",
        results: [],
        pagination: calculatePagination(0, topN, page),
      };
    }

    const totalResults = allPlaces.length;
    const totalPages = Math.ceil(totalResults / topN);
    const startIdx = (page - 1) * topN;
    const endIdx = Math.min(startIdx + topN, totalResults);

    if (startIdx >= totalResults) {
      throw new Error(
        `Page ${page} not found. Total pages available: ${totalPages}`,
      );
    }

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

  if (!GOOGLE_MAPS_API_KEY || !DEEPSEEK_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "API keys not configured" }),
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

    // Preprocess query with LLM
    const originalQuery = query.trim();
    const processedQuery = await preprocessQueryWithLLM(originalQuery);

    // Search places with processed query
    const result = await searchPlaces(processedQuery, top_n, page);

    // Add query information to response
    result.original_query = originalQuery;
    result.processed_query = processedQuery;

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
