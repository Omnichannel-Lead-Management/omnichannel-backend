# Omnichannel Lead Management - Deployment

## Overview
This repository contains the Docker Compose deployment for the Omnichannel Lead Management Platform.

## CI/CD Status

| Service | Build Status |
|---------|-------------|
| Messaging Orchestrator | [![Build](https://github.com/Rexosphere/Hemas-Message-Orchestrator/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Rexosphere/Hemas-Message-Orchestrator/actions/workflows/docker-publish.yml) |
| Routing Agent | [![Build](https://github.com/Rexosphere/Hemas-Routing-Agent/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Rexosphere/Hemas-Routing-Agent/actions/workflows/docker-publish.yml) |
| Product Agent | [![Build](https://github.com/Rexosphere/Hemas-Product-Agent/actions/workflows/docker.yml/badge.svg)](https://github.com/Rexosphere/Hemas-Product-Agent/actions/workflows/docker.yml) |
| Ordering Agent | [![Build](https://github.com/Rexosphere/Hemas_Ordering_System/actions/workflows/docker.yml/badge.svg)](https://github.com/Rexosphere/Hemas_Ordering_System/actions/workflows/docker.yml) |
| Complaint Agent | [![Build](https://github.com/Rexosphere/Hemas-Complaint-Agent/actions/workflows/docker.yml/badge.svg)](https://github.com/Rexosphere/Hemas-Complaint-Agent/actions/workflows/docker.yml) |
| Photo Agent | [![Build](https://github.com/Rexosphere/Hemas-Photo-Agent/actions/workflows/docker.yml/badge.svg)](https://github.com/Rexosphere/Hemas-Photo-Agent/actions/workflows/docker.yml) |
| MCP Server | [![Build](https://github.com/Rexosphere/Hemas-MCP/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Rexosphere/Hemas-MCP/actions/workflows/docker-publish.yml) |
| Recommender | [![Build](https://github.com/Rexosphere/Hemas-Recommender/actions/workflows/docker.yml/badge.svg)](https://github.com/Rexosphere/Hemas-Recommender/actions/workflows/docker.yml) |
| Vision API | [![Build](https://github.com/Rexosphere/AI-vision-for-product-search/actions/workflows/docker-release.yml/badge.svg)](https://github.com/Rexosphere/AI-vision-for-product-search/actions/workflows/docker-release.yml) |
| Analytics Service | [![Build](https://github.com/Rexosphere/Hemas-Analytics-Service/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Rexosphere/Hemas-Analytics-Service/actions/workflows/docker-publish.yml) |
| Notification Service | [![Build](https://github.com/Rexosphere/Hemas-Notification-Service/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Rexosphere/Hemas-Notification-Service/actions/workflows/docker-publish.yml) |

## What This Deploys
- messaging-orchestrator
- routing-agent
- product-agent
- ordering-agent
- complaint-agent
- photo-agent
- product-mcp
- recommender-service
- vision-service
- pocketbase
- analytics-service
- notification-service

## Prerequisites
- Docker 24+
- Docker Compose v2
- Access to required API keys and external services:
  - Vertex AI (`aiplatform.googleapis.com`) enabled on the GCP project, with the
    host VM's service account granted `roles/aiplatform.user`. Gemini is reached
    through Vertex AI using the VM's Application Default Credentials — set
    `GOOGLE_CLOUD_PROJECT` in `.env`; no API key is stored.
  - Azure Vision and Azure Search (for vision service)
  - Qdrant (for complaint retrieval)

## Setup
```bash
cd deployment
cp .env.example .env
```

Fill `.env` values before startup.

## Run
```bash
docker compose up --build -d
```

Check status:
```bash
docker compose ps
docker compose logs -f
```

Stop:
```bash
docker compose down
```

Reset volumes:
```bash
docker compose down -v
```

## Service Ports
- `3000` Messaging Orchestrator
- `3001` Routing Agent
- `3002` Product Agent
- `3003` Ordering System
- `3004` Complaint Agent
- `3005` Photo Agent
- `8001` MCP Server
- `8002` Recommender
- `8003` Vision API
- `8007` Notification Service
- `8008` Analytics Service
- `8090` PocketBase

## Shared Data
`shared_data` volume is mounted to allow services to read shared SQLite files efficiently:
- `/data/orchestrator.db`
- `/data/ordering.db`
- `/data/notifications.db`

## Core Health Endpoints
- `GET http://localhost:3000/api/health/all`
- `GET http://localhost:3001/health`
- `GET http://localhost:3003/health`
- `GET http://localhost:8002/health`
- `GET http://localhost:8007/health`
- `GET http://localhost:8008/analytics/health`

## How It Works
1. Messaging orchestrator receives incoming channel traffic (web, telegram, whatsapp).
2. Routing agent classifies intent and forwards requests to specialist agents.
3. Specialist agents call MCP/tools and return structured responses.
4. Ordering and notification services handle order lifecycle and nudges.
5. Analytics service reads operational data and provides dashboard APIs.

## Notes
- Keep `.env` consistent with service `.env.example` files across repos.
- If you use image tags from a registry, ensure the tags are updated and available.
