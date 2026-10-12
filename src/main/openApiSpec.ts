import { ApiEndpointDoc } from '../shared/types';

export const API_ENDPOINTS: ApiEndpointDoc[] = [
  // --- SYSTEM & SUPERVISOR ---
  {
    id: 'get-system-info',
    method: 'GET',
    path: '/api/system-info',
    category: 'System & Hardware',
    summary: 'Hardware & OS Metrics',
    description: 'Retrieves CPU architecture, RAM consumption, local Wi-Fi IP, Tailscale IP, Node & Electron runtime versions.',
    sampleResponse: {
      platform: 'win32',
      arch: 'x64',
      release: '10.0.26300',
      totalMemoryMb: 16384,
      freeMemoryMb: 7420,
      localIp: '192.168.1.100',
      tailscaleIp: '100.90.12.34',
    },
  },
  {
    id: 'get-services',
    method: 'GET',
    path: '/api/services',
    category: 'Process Supervisor',
    summary: 'List Managed Services',
    description: 'Returns all configured and discovered native Windows service processes registered in the database.',
    sampleResponse: [
      {
        id: 'caddy-proxy',
        name: 'Caddy Reverse Proxy',
        type: 'caddy',
        executable: 'caddy.exe',
        port: 80,
        status: 'running',
        autoStart: true,
      },
    ],
  },
  {
    id: 'start-service',
    method: 'POST',
    path: '/api/services/:id/start',
    category: 'Process Supervisor',
    summary: 'Start Native Service',
    description: 'Launches the designated native executable as a detached Windows process monitored by the supervisor.',
    parameters: [
      { name: 'id', type: 'string', required: true, description: 'Service ID to start', in: 'path' },
    ],
    sampleResponse: { success: true, pid: 14208 },
  },
  {
    id: 'stop-service',
    method: 'POST',
    path: '/api/services/:id/stop',
    category: 'Process Supervisor',
    summary: 'Graceful Stop Service',
    description: 'Terminates the process tree via Windows native taskkill /PID <PID> /T /F.',
    parameters: [
      { name: 'id', type: 'string', required: true, description: 'Service ID to stop', in: 'path' },
    ],
    sampleResponse: { success: true },
  },
  {
    id: 'restart-service',
    method: 'POST',
    path: '/api/services/:id/restart',
    category: 'Process Supervisor',
    summary: 'Restart Native Service',
    description: 'Stops and re-executes the specified service with renewed port bindings.',
    parameters: [
      { name: 'id', type: 'string', required: true, description: 'Service ID to restart', in: 'path' },
    ],
    sampleResponse: { success: true, pid: 18920 },
  },
  {
    id: 'get-service-logs',
    method: 'GET',
    path: '/api/services/:id/logs',
    category: 'Process Supervisor',
    summary: 'Stream Process Logs',
    description: 'Retrieves stdout and stderr console buffer captured from the supervised Windows process.',
    parameters: [
      { name: 'id', type: 'string', required: true, description: 'Service ID', in: 'path' },
    ],
    sampleResponse: [
      { id: '1', level: 'info', source: 'caddy', message: 'serving initial configuration', timestamp: '2026-10-12T16:00:00Z' },
    ],
  },

  // --- FILE MANAGER & STREAMING ---
  {
    id: 'list-files',
    method: 'GET',
    path: '/api/files/list',
    category: 'File Manager & Media',
    summary: 'List Directory Contents',
    description: 'Lists files, folders, sizes, mime types, and media flags within the server storage directory.',
    parameters: [
      { name: 'path', type: 'string', required: false, description: 'Relative directory subpath (leave empty for root)', in: 'query', default: '' },
    ],
    sampleResponse: {
      currentPath: '',
      parentPath: null,
      items: [
        {
          name: 'The Angry Birds Movie (2016).mkv',
          path: 'The Angry Birds Movie (2016).mkv',
          isDirectory: false,
          size: 2890148562,
          modifiedAt: '2026-10-11T01:10:00Z',
          isVideo: true,
          mimeType: 'video/x-matroska',
        },
      ],
      totalCount: 1,
      totalSize: 2890148562,
    },
  },
  {
    id: 'stream-file',
    method: 'GET',
    path: '/api/files/stream',
    category: 'File Manager & Media',
    summary: 'HTTP 206 Partial Content Stream',
    description: 'High-performance media streaming engine supporting HTTP 206 Byte-Range requests for mobile video seeking on iOS and Android.',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Relative path of the media file to stream', in: 'query' },
    ],
    sampleResponse: '[Binary Video/Audio Stream with Content-Range: bytes START-END/TOTAL]',
  },
  {
    id: 'download-file',
    method: 'GET',
    path: '/api/files/download',
    category: 'File Manager & Media',
    summary: 'Download File as Attachment',
    description: 'Streams file with Content-Disposition attachment header for direct mobile or desktop downloads.',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Relative path of file', in: 'query' },
    ],
    sampleResponse: '[Binary Download]',
  },
  {
    id: 'upload-file',
    method: 'POST',
    path: '/api/files/upload',
    category: 'File Manager & Media',
    summary: 'Upload File to Server',
    description: 'Accepts file uploads from mobile camera, photo library, or desktop into specified target directory.',
    parameters: [
      { name: 'targetPath', type: 'string', required: false, description: 'Target directory subpath', in: 'query' },
      { name: 'filename', type: 'string', required: true, description: 'Destination filename', in: 'query' },
    ],
    sampleRequest: '[Raw Binary / Form Data Payload]',
    sampleResponse: { success: true, path: 'uploads/photo.jpg' },
  },
  {
    id: 'mkdir',
    method: 'POST',
    path: '/api/files/mkdir',
    category: 'File Manager & Media',
    summary: 'Create New Directory',
    description: 'Creates a new folder inside the designated parent directory.',
    sampleRequest: { targetPath: '', folderName: 'New Folder' },
    sampleResponse: { success: true },
  },
  {
    id: 'rename-file',
    method: 'POST',
    path: '/api/files/rename',
    category: 'File Manager & Media',
    summary: 'Rename File or Folder',
    description: 'Renames an existing item safely.',
    sampleRequest: { oldPath: 'old_name.txt', newName: 'new_name.txt' },
    sampleResponse: { success: true },
  },
  {
    id: 'delete-file',
    method: 'DELETE',
    path: '/api/files/delete',
    category: 'File Manager & Media',
    summary: 'Delete File or Directory',
    description: 'Removes file or directory recursively.',
    sampleRequest: { path: 'unwanted_file.mp4' },
    sampleResponse: { success: true },
  },

  // --- GOOGLE PHOTOS & MEMORIES ---
  {
    id: 'photos-timeline',
    method: 'GET',
    path: '/api/photos/timeline',
    category: 'Photos & Memories',
    summary: 'Get Chronological Photo Timeline',
    description: 'Scans all images and videos and groups them into chronological timeline sections (Today, Yesterday, Months).',
    parameters: [
      { name: 'favoritesOnly', type: 'boolean', required: false, description: 'Filter only starred favorites', in: 'query' },
      { name: 'type', type: 'string', required: false, description: 'Filter by "photo" or "video"', in: 'query' },
    ],
    sampleResponse: {
      timeline: [
        {
          dateHeader: 'Today',
          items: [
            {
              id: 'vacation.jpg',
              name: 'vacation.jpg',
              path: 'vacation.jpg',
              type: 'photo',
              mediaUrl: '/api/photos/media?path=vacation.jpg',
              streamUrl: '/api/files/stream?path=vacation.jpg',
              isFavorite: true,
              dateFormatted: 'Sun, Oct 12, 2026',
            },
          ],
        },
      ],
      totalCount: 42,
      photosCount: 38,
      videosCount: 4,
    },
  },
  {
    id: 'photos-favorite',
    method: 'POST',
    path: '/api/photos/favorite',
    category: 'Photos & Memories',
    summary: 'Toggle Favorite (Star)',
    description: 'Marks or unmarks a photo/video as a favorite.',
    sampleRequest: { path: 'vacation.jpg' },
    sampleResponse: { success: true, isFavorite: true },
  },

  // --- POSTGRESQL & PRISMA ---
  {
    id: 'postgres-status',
    method: 'GET',
    path: '/api/postgres-status',
    category: 'Relational Database',
    summary: 'PostgreSQL Health & TCP State',
    description: 'Inspects portable PostgreSQL process state, port 5432 probe, and socket connection liveness.',
    sampleResponse: {
      state: 'running',
      port: 5432,
      isPortListening: true,
      canConnect: true,
      dataDir: 'C:\\Users\\...\\postgres',
    },
  },
  {
    id: 'execute-query',
    method: 'POST',
    path: '/api/execute-query',
    category: 'Relational Database',
    summary: 'Run SQL Query directly',
    description: 'Executes parameterized or raw SQL query through Prisma data proxy to PostgreSQL database.',
    sampleRequest: { sql: 'SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\';' },
    sampleResponse: { success: true, data: [{ table_name: 'services' }, { table_name: 'routes' }] },
  },

  // --- CADDY PROXY & DOMAINS ---
  {
    id: 'caddy-routes',
    method: 'GET',
    path: '/api/routes',
    category: 'Reverse Proxy & Domains',
    summary: 'List Registered Web Domains',
    description: 'Returns all virtual hosts and proxy routes mapped in Caddy dynamic reverse proxy.',
    sampleResponse: [
      { id: 'route-1', subdomain: 'files', targetPort: 8080, targetHost: '127.0.0.1', tlsEnabled: true },
    ],
  },
  {
    id: 'caddy-sync',
    method: 'POST',
    path: '/api/caddy/sync',
    category: 'Reverse Proxy & Domains',
    summary: 'Sync Routes to Caddy Admin API',
    description: 'Pushes all database-defined host mappings to Caddy REST Admin API (:2019) with zero server reload.',
    sampleResponse: { success: true, count: 4 },
  },

  // --- TAILSCALE MESH VPN ---
  {
    id: 'tailscale-status',
    method: 'GET',
    path: '/api/tailscale/status',
    category: 'Mesh VPN Overlay',
    summary: 'Tailscale Mesh Status',
    description: 'Inspects WireGuard mesh connection, node status, and remote 100.x.y.z IP assignment.',
    sampleResponse: {
      connected: true,
      ip: '100.90.12.34',
      binaryPath: 'extraResources\\bin\\tailscale.exe',
    },
  },
];

export function getOpenApiSpec(host: string = '127.0.0.1:3001') {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Native Windows Server Hub - Universal REST API',
      version: '0.1.0',
      description: 'Comprehensive, mobile-friendly REST API for Native Windows Server Hub orchestration, file management, media streaming, Google Photos gallery, PostgreSQL, and reverse proxy routing.',
      contact: {
        name: 'rhmunna143',
        url: 'https://github.com/rhmunna143/native-windows-server-prototype',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: `http://${host}`,
        description: 'Native Windows Server Hub Instance',
      },
    ],
    paths: API_ENDPOINTS.reduce((acc: any, ep) => {
      const pathKey = ep.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
      if (!acc[pathKey]) acc[pathKey] = {};
      const methodKey = ep.method.toLowerCase();
      acc[pathKey][methodKey] = {
        tags: [ep.category],
        summary: ep.summary,
        description: ep.description,
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  example: ep.sampleResponse,
                },
              },
            },
          },
        },
      };
      return acc;
    }, {}),
  };
}
