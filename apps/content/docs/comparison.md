---
title: Comparison
description: How is oRPC different from other RPC or REST solutions?
---

# Comparison

This comparison table helps you understand how oRPC differs from other popular TypeScript RPC and REST solutions.

- ✅ First-class, built-in support
- 🟡 Lacks features, or requires third-party integrations
- 🛑 Not supported or not documented

| Feature                                  | oRPC | tRPC | ts-rest |
| ---------------------------------------- | ---- | ---- | ------- |
| End-to-end Input/Output Typesafe         | ✅   | ✅   | ✅      |
| End-to-end Errors Typesafe               | ✅   | ✅   | ✅      |
| End-to-end File/Blob Typesafe            | ✅   | ✅   | 🛑      |
| End-to-end Streaming Typesafe            | ✅   | ✅   | 🛑      |
| Tanstack Query Integration (React)       | ✅   | ✅   | 🟡      |
| Tanstack Query Integration (Vue)         | ✅   | 🛑   | 🟡      |
| Tanstack Query Integration (Solid)       | ✅   | 🛑   | 🟡      |
| Tanstack Query Integration (Svelte)      | ✅   | 🛑   | 🛑      |
| Vue Pinia Colada Integration             | ✅   | 🛑   | 🛑      |
| With Contract-First Approach             | ✅   | 🛑   | ✅      |
| Without Contract-First Approach          | ✅   | ✅   | 🛑      |
| OpenAPI Support                          | ✅   | 🟡   | 🟡      |
| Server Actions Support                   | ✅   | ✅   | 🛑      |
| Lazy Router                              | ✅   | ✅   | 🛑      |
| Native Types (Date, URL, Set, Maps, ...) | ✅   | ✅   | 🛑      |
| Streaming response (SSE)                 | ✅   | ✅   | 🛑      |
| Standard Schema                          | ✅   | ✅   | 🛑      |
| Plugins-able (CORS, ...)                 | ✅   | ✅   | 🛑      |
| Dedicated Zod Schemas                    | ✅   | N/A  | 🛑      |
| Use Native Modules on each runtime       | ✅   | ✅   | 🟡      |
| Batch Request                            | 🛑   | ✅   | 🛑      |
| WebSockets                               | 🛑   | ✅   | 🛑      |
| Nest.js integration                      | 🛑   | 🟡   | ✅      |
