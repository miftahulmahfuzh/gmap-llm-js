# AI Places Finder

A web application that compares standard Google Maps search with AI-enhanced query processing. Users can toggle between modes to see how LLM preprocessing affects search results quality and performance.

## Architecture

**Frontend**: Static HTML/CSS/JavaScript

**Backend Options**:

- Netlify Functions (Node.js serverless)
- Client-side only (GitHub Pages compatible)

## Core Features

- **Dual Search Modes**: Compare standard vs AI-enhanced Google Places searches
- **Real-time Performance Metrics**: View search duration and query processing details
- **Result Caching**: Instant comparison between search modes
- **Pagination**: Navigate through up to 60 results (Google API limit)
- **Embedded Maps**: Interactive Google Maps in each result card
- **Responsive Design**: Works on desktop and mobile

## Quick Start (Local Development)

### 1. Get API Keys

**Google Maps API**:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project and enable billing
3. Enable: Places API, Maps Embed API
4. Create API key and restrict to these APIs only

**DeepSeek API**:
1. Sign up at [DeepSeek](https://platform.deepseek.com/)
2. Generate API key
```

### 3. Configure API Keys

Create `.env` file:
```
GOOGLE_MAPS_API_KEY=your_google_key_here
DEEPSEEK_API_KEY=your_deepseek_key_here
```


## Deployment Options

### Netlify (Recommended)

**Benefits**: Secure API keys, serverless functions, global CDN

1. Convert Python functions to Node.js (provided in artifacts)
2. Create `netlify/functions/` directory structure
3. Deploy via Netlify dashboard or CLI
4. Set environment variables in Netlify dashboard

## API Endpoints

### Netlify Functions
- `POST /.netlify/functions/find-places`
- `POST /.netlify/functions/find-places-llm`

**Request Format**:
```json
{
  "query": "best pizza in New York",
  "top_n": 10,
  "page": 1
}
```

**Response Format**:
```json
{
  "status": "OK",
  "results": [...],
  "pagination": {...},
  "original_query": "...",
  "processed_query": "..."
}
```

## Project Structure

```
gmap-llm-js/
├── index.html              (Netlify version)
├── style.css               (keep your existing CSS)
├── netlify.toml            (Netlify configuration)
├── netlify/
│   └── functions/
│       ├── find-places.js      (standard search)
│       └── find-places-llm.js  (AI-enhanced search)
└── README.md
```

## How It Works

1. **User Input**: Enter natural language query
2. **Mode Selection**: Choose standard or AI-enhanced search
3. **Processing**:
   - **Standard**: Direct Google Places API call
   - **AI Enhanced**: LLM processes query first, then searches
4. **Results**: Display with embedded maps and performance metrics
5. **Comparison**: Toggle modes to compare results instantly

## Security Considerations

- Never commit `.env` files
- Restrict Google API keys to specific APIs and domains
- Use environment variables for production deployments
- Consider rate limiting for production use

## Common Issues

**CORS Errors**: Ensure FastAPI includes CORS middleware or use proper deployment method

**Maps Not Loading**: Verify Google Maps API key and enabled APIs

**API Connection Failed**: Check that backend server is running and accessible

**Rate Limits**: Google Places API has usage quotas - monitor in Google Cloud Console

## Performance Notes

- Google Places API returns max 20 results per request
- App fetches up to 3 pages (60 total results)
- Client-side caching prevents duplicate requests
- LLM preprocessing adds ~1-2 seconds to search time

## Contributing

This is a demonstration project. For production use, implement proper error handling, authentication, and monitoring.
