# Upstream Open-Source License Notices & Attribution

Ownbase orchestrates genuine upstream native binaries and standard open-source runtimes. This document provides third-party license attributions, copyright notices, and license texts in compliance with upstream distribution terms (PRD §Phase 6 & Item 6.6).

---

## 1. Upstream Native Services & Components

### FileBrowser Cloud Drive
- **Upstream Project:** [FileBrowser](https://github.com/filebrowser/filebrowser)
- **Version:** v2.30.0
- **License:** Apache License 2.0
- **Copyright:** Copyright © 2017-present FileBrowser authors
- **Terms:** Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at `http://www.apache.org/licenses/LICENSE-2.0`.

### Caddy Web Server & Reverse Proxy
- **Upstream Project:** [Caddy](https://github.com/caddyserver/caddy)
- **Version:** v2.8.4
- **License:** Apache License 2.0
- **Copyright:** Copyright © 2015-present Matthew Holt and The Caddy Authors
- **Terms:** Licensed under the Apache License, Version 2.0.

### Ollama Local LLM Runner
- **Upstream Project:** [Ollama](https://github.com/ollama/ollama)
- **Version:** v0.1.32+
- **License:** MIT License
- **Copyright:** Copyright © 2023-present Jeffrey Morgan and the Ollama authors
- **Terms:** Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.

### MinIO S3-Compatible Object Storage
- **Upstream Project:** [MinIO](https://github.com/minio/minio)
- **Version:** RELEASE.2024
- **License:** GNU Affero General Public License v3.0 (AGPL-3.0)
- **Copyright:** Copyright © 2015-present MinIO, Inc.
- **Terms:** MinIO is distributed under the GNU AGPL v3.0. Ownbase interacts with MinIO strictly over standard S3 HTTP/REST socket boundaries as a separate independent process, without linking or modifying MinIO source code. Source code is available at `https://github.com/minio/minio`.

### PostgreSQL Database Server
- **Upstream Project:** [PostgreSQL](https://www.postgresql.org/)
- **Version:** v16.1+
- **License:** PostgreSQL License (similar to BSD / MIT)
- **Copyright:** Copyright © 1996-present The PostgreSQL Global Development Group
- **Terms:** Permission to use, copy, modify, and distribute this software and its documentation for any purpose, without fee, and without a written agreement is hereby granted.

### Tailscale WireGuard Mesh VPN
- **Upstream Project:** [Tailscale Open Source Client](https://github.com/tailscale/tailscale)
- **License:** BSD-3-Clause
- **Copyright:** Copyright © 2020-present Tailscale Inc.
- **Terms:** Redistribution and use in source and binary forms, with or without modification, are permitted provided that the copyright notice and disclaimer are retained.

---

## 2. Managed Runtimes

### Node.js (Host & Managed LTS)
- **Project:** [Node.js](https://nodejs.org/)
- **License:** MIT License
- **Copyright:** Copyright Node.js contributors

### Python (Standalone Windows Distribution)
- **Project:** [Python Software Foundation](https://www.python.org/)
- **Version:** 3.11+
- **License:** Python Software Foundation License (PSFL)
- **Copyright:** Copyright © 2001-present Python Software Foundation

### Go Language Runtime
- **Project:** [The Go Authors](https://go.dev/)
- **Version:** 1.22+
- **License:** BSD-3-Clause
- **Copyright:** Copyright © 2009-present The Go Authors

---

## 3. Terminal & Client Libraries

| Library | License | Usage |
| :--- | :--- | :--- |
| `node-pty` | MIT | Native Windows ConPTY process spawning |
| `@xterm/xterm` | MIT | Web-based interactive terminal emulation |
| `@xterm/addon-fit` | MIT | Dynamic terminal viewport resizing |
| `ws` | MIT | WebSocket RFC 6455 server and streaming |
| `koffi` | MIT | Win32 kernel32 C FFI binding for Job Objects |
| `argon2` | MIT | Memory-hard Argon2id password hashing |
| `prisma` / `@prisma/client` | Apache-2.0 | Type-safe database ORM and migrations |
| `next` / `react` | MIT | Frontend dashboard user interface |
