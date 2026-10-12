# 🌐 Native Windows Server Hub — Universal REST API Documentation

Comprehensive REST API reference for **Native Windows Server Hub**. These APIs allow you to build custom mobile clients (**Flutter**, **React Native**, **Swift**, **Kotlin**), web applications, CLI tools, and IoT automation scripts connected to your Windows server.

---

## 🚀 Base URL & Connectivity

All APIs run on port **3001** (native bridge) and are also reverse-proxied on port **80** by Caddy:

| Environment | Base URL | Description |
| :--- | :--- | :--- |
| **Local Machine** | `http://localhost:3001` or `http://localhost` | Running on same Windows laptop |
| **Local Wi-Fi / LAN** | `http://<LAN_IP>:3001` or `http://<LAN_IP>` | Accessible by mobile phones & laptops on same Wi-Fi |
| **Tailscale Mesh VPN** | `http://<Tailscale_IP>:3001` or `http://<Tailscale_IP>` | Secure worldwide encrypted access |

> **CORS Policy:** All endpoints support full CORS (`Access-Control-Allow-Origin: *`) with support for `Range`, `Content-Range`, and `Authorization` headers.

---

## 📑 OpenAPI 3.0 Specification

You can import the complete OpenAPI 3.0 spec directly into **Postman**, **Insomnia**, or **Swagger UI**, or generate client SDKs via `openapi-generator-cli`:

```bash
# Download OpenAPI 3.0 specification
curl -s http://localhost:3001/api/openapi.json -o openapi.json

# Generate Flutter / Dart client SDK
openapi-generator-cli generate -i openapi.json -g dart -o ./flutter_sdk

# Generate Swift (iOS) client SDK
openapi-generator-cli generate -i openapi.json -g swift5 -o ./swift_sdk
```

---

## 1. 📁 File Explorer & Mobile Media Streaming

### `GET /api/files/list`
Lists directory contents, file sizes, mime types, and media flags.

**Query Parameters:**
- `path` *(optional)*: Subpath relative to server storage (e.g. `path=Movies` or `path=Photos`). Omit for root.

**Example Request:**
```bash
curl "http://localhost:3001/api/files/list?path="
```

**Example Response (200 OK):**
```json
{
  "currentPath": "",
  "parentPath": null,
  "items": [
    {
      "name": "The Angry Birds Movie (2016).mkv",
      "path": "The Angry Birds Movie (2016).mkv",
      "isDirectory": false,
      "size": 2890148562,
      "modifiedAt": "2026-10-11T01:10:00.000Z",
      "extension": ".mkv",
      "mimeType": "video/x-matroska",
      "isVideo": true,
      "isImage": false,
      "isAudio": false,
      "isText": false
    },
    {
      "name": "Ms",
      "path": "Ms",
      "isDirectory": true,
      "size": 0,
      "modifiedAt": "2026-10-11T16:13:00.000Z",
      "extension": "",
      "mimeType": "application/octet-stream",
      "isVideo": false,
      "isImage": false,
      "isAudio": false,
      "isText": false
    }
  ],
  "totalCount": 2,
  "totalSize": 2890148562
}
```

---

### `GET /api/files/stream` (HTTP 206 Partial Content)
Streams video and audio files with **HTTP 206 Byte-Range** support. This is required by iOS Safari, Android Chrome, and modern media players for seamless seeking and video playback.

**Query Parameters:**
- `path` *(required)*: Relative path to the media file.

**Example Request with Byte Range:**
```bash
curl -i -H "Range: bytes=0-1048575" "http://localhost:3001/api/files/stream?path=The%20Angry%20Birds%20Movie%20(2016).mkv"
```

**Example Headers Returned (206 Partial Content):**
```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1048575/2890148562
Accept-Ranges: bytes
Content-Length: 1048576
Content-Type: video/x-matroska
```

---

### `GET /api/files/download`
Downloads a file with standard attachment headers.

```bash
curl -O "http://localhost:3001/api/files/download?path=document.pdf"
```

---

### `POST /api/files/upload`
Uploads a file directly from mobile or desktop into a destination folder.

**Query Parameters:**
- `targetPath` *(optional)*: Subfolder (e.g. `Photos` or `Movies`).
- `filename` *(required)*: File name.

**Example Request:**
```bash
curl -X POST "http://localhost:3001/api/files/upload?targetPath=Photos&filename=camera_photo.jpg" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@my_local_photo.jpg"
```

---

### `POST /api/files/mkdir`
Creates a new directory inside the storage root.

**Payload:**
```json
{
  "targetPath": "",
  "folderName": "Family Videos"
}
```

---

### `POST /api/files/rename`
Renames an item.

**Payload:**
```json
{
  "oldPath": "old_name.mp4",
  "newName": "new_name.mp4"
}
```

---

### `DELETE /api/files/delete`
Deletes a file or directory.

**Payload:**
```json
{
  "path": "unwanted_file.mp4"
}
```

---

## 2. 📸 Google Photos & Memories Service

### `GET /api/photos/timeline`
Scans all photos and videos and groups them chronologically by date sections ("Today", "Yesterday", "October 2026", etc.).

**Query Parameters:**
- `favoritesOnly` *(optional, boolean)*: Set `true` to only fetch starred items.
- `type` *(optional, string)*: Filter by `photo`, `video`, or `all`.

**Example Request:**
```bash
curl "http://localhost:3001/api/photos/timeline?type=all"
```

**Example Response (200 OK):**
```json
{
  "timeline": [
    {
      "dateHeader": "Today",
      "items": [
        {
          "id": "Photos/IMG_2026.jpg",
          "name": "IMG_2026.jpg",
          "path": "Photos/IMG_2026.jpg",
          "type": "photo",
          "mimeType": "image/jpeg",
          "size": 4256192,
          "date": "2026-10-12T14:30:00.000Z",
          "dateFormatted": "Mon, Oct 12, 2026",
          "groupKey": "Today",
          "mediaUrl": "/api/photos/media?path=Photos%2FIMG_2026.jpg",
          "streamUrl": "/api/files/stream?path=Photos%2FIMG_2026.jpg",
          "isFavorite": true
        }
      ]
    }
  ],
  "totalCount": 120,
  "photosCount": 105,
  "videosCount": 15
}
```

---

### `POST /api/photos/favorite`
Toggles favorite state (star) for a photo or video.

**Payload:**
```json
{
  "path": "Photos/IMG_2026.jpg"
}
```

**Response:**
```json
{
  "success": true,
  "isFavorite": true
}
```

---

## 3. 🖥️ Process Supervisor & Server Apps

### `GET /api/services`
Lists all managed native Windows services.

```bash
curl "http://localhost:3001/api/services"
```

### `POST /api/services/:id/start`
Starts a service.

```bash
curl -X POST "http://localhost:3001/api/services/caddy-proxy/start"
```

### `POST /api/services/:id/stop`
Stops a service.

```bash
curl -X POST "http://localhost:3001/api/services/caddy-proxy/stop"
```

### `POST /api/services/:id/restart`
Restarts a service.

```bash
curl -X POST "http://localhost:3001/api/services/caddy-proxy/restart"
```

### `GET /api/services/:id/logs`
Retrieves stdout / stderr console logs for a service.

```bash
curl "http://localhost:3001/api/services/caddy-proxy/logs"
```

---

## 4. 🗄️ PostgreSQL Database

### `GET /api/postgres-status`
Retrieves PostgreSQL daemon status, TCP port 5432 probe, and socket connection state.

```bash
curl "http://localhost:3001/api/postgres-status"
```

### `POST /api/execute-query`
Executes SQL queries through the database engine.

**Payload:**
```json
{
  "sql": "SELECT * FROM \"Service\" LIMIT 10;"
}
```

---

## 5. 🌐 Caddy Reverse Proxy & Domains

### `GET /api/routes`
Lists all reverse proxy routes mapped in Caddy.

### `POST /api/caddy/sync`
Forces dynamic route synchronization to Caddy REST Admin API (`:2019`) with zero downtime.

```bash
curl -X POST "http://localhost:3001/api/caddy/sync"
```

---

## 6. 🔒 Tailscale Mesh VPN

### `GET /api/tailscale/status`
Checks WireGuard mesh connection and IP.

```bash
curl "http://localhost:3001/api/tailscale/status"
```

### `POST /api/tailscale/connect`
Connects using an auth key.

**Payload:**
```json
{
  "authKey": "tskey-auth-...",
  "hostname": "windows-server-hub"
}
```

---

## 💡 Flutter / Mobile Example (Dart)

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class ServerHubClient {
  final String baseUrl;
  ServerHubClient(this.baseUrl);

  // Fetch file list
  Future<List<dynamic>> listFiles({String path = ''}) async {
    final res = await http.get(Uri.parse('$baseUrl/api/files/list?path=$path'));
    if (res.statusCode == 200) {
      return jsonDecode(res.body)['items'];
    }
    throw Exception('Failed to load files');
  }

  // Fetch photos timeline
  Future<List<dynamic>> getPhotosTimeline() async {
    final res = await http.get(Uri.parse('$baseUrl/api/photos/timeline'));
    if (res.statusCode == 200) {
      return jsonDecode(res.body)['timeline'];
    }
    throw Exception('Failed to load photos');
  }

  // Stream video URL for VideoPlayerController
  String getVideoUrl(String relativePath) {
    return '$baseUrl/api/files/stream?path=${Uri.encodeComponent(relativePath)}';
  }
}
```
