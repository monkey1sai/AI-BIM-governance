# Other

# Other Module Overview

The **Other** module serves as a comprehensive framework for managing and facilitating interactions within the `AI-BIM-governance/` workspace. It encompasses several sub-modules that collectively support the development, testing, and deployment of Building Information Modeling (BIM) applications. The key components include:

- **AGENTS.md**: Defines the responsibilities and interactions among the core repositories, establishing boundaries and data flows.
- **CLAUDE**: Provides an architectural overview and interaction patterns among the repositories, detailing their roles and communication protocols.
- **_bim-control**: Acts as a local fake BIM data authority, managing metadata related to conversion results and enabling testing without a live backend.
- **_conversion-service**: Facilitates the conversion of IFC files to USDC format, managing requests and publishing results to the BIM control system and S3 storage.
- **_s3_storage**: Offers a mock object storage solution for testing BIM conversion workflows, ensuring a controlled environment for file access.
- **bim-review-coordinator**: Manages review sessions, enabling collaboration on BIM projects by creating and broadcasting review events.

## Key Workflows

1. **BIM Data Conversion**: The `_conversion-service` processes IFC files, converting them to USDC format and storing results in `_s3_storage`. The `_bim-control` module manages metadata related to these conversions, ensuring that developers can test their applications against a consistent dataset.

2. **Review Session Management**: The `bim-review-coordinator` module orchestrates review sessions, utilizing data from `_bim-control` to bootstrap artifacts and issues. It broadcasts events to connected clients, allowing real-time collaboration.

3. **Testing and Validation**: The `_bim-control-tests` and `_conversion-service-tests` modules provide integration and unit tests, ensuring that the APIs and workflows function as expected. The `scripts` module includes health checks and smoke tests to verify service availability.

4. **Web Client Interaction**: The `web-viewer-sample` module serves as a front-end client, demonstrating how to stream BIM data and interact with the backend services. It integrates with the `bim-streaming-server` to deliver real-time visualizations.

## Sub-modules

- [AGENTS.md](Other-AGENTS.md)
- [CLAUDE](Other-CLAUDE.md)
- [_bim-control](Other-_bim-control.md)
- [_conversion-service](Other-_conversion-service.md)
- [_s3_storage](Other-_s3_storage.md)
- [bim-review-coordinator](Other-bim-review-coordinator.md)
- [web-viewer-sample](Other-web-viewer-sample.md)

This modular architecture allows for flexibility and scalability, enabling developers to build robust BIM applications while ensuring seamless integration across various components.
