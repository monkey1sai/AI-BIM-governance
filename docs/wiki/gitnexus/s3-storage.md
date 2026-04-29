# S3 Storage

# S3 Storage Module Documentation

## Overview

The **S3 Storage** module provides a FastAPI application that simulates an S3 storage service. It serves static files and exposes a health check endpoint. This module is designed to facilitate testing and development by providing a local storage solution that mimics the behavior of AWS S3.

## Purpose

The primary purpose of this module is to create a lightweight, local server that can handle static file storage and retrieval. It is particularly useful for testing applications that interact with S3 without needing to connect to an actual S3 service.

## Key Components

### 1. FastAPI Application

The core of the module is a FastAPI application created by the `create_app` function. This function initializes the application and sets up the necessary routes and static file serving.

### 2. Static File Serving

The application serves static files from a specified directory. If no directory is provided, it defaults to a `static` folder located in the module's root directory. The static files are accessible via the `/static` endpoint.

### 3. Health Check Endpoint

The module includes a health check endpoint at `/health`, which returns the status of the service and the path to the static root directory. This is useful for monitoring and ensuring that the service is running correctly.

## Functionality

### `create_app(static_root: Path | str | None = None) -> FastAPI`

- **Parameters**:
  - `static_root`: Optional. A string or Path object specifying the directory for static files. If not provided, defaults to the `static` directory in the module's root.

- **Returns**: An instance of `FastAPI`.

- **Description**:
  - Resolves the static root path and creates the necessary directory if it does not exist.
  - Initializes the FastAPI application with a title and version.
  - Defines the `/health` endpoint to return the service status.
  - Mounts the static files directory to the `/static` endpoint.

### Health Check Endpoint

- **Endpoint**: `GET /health`
- **Response**:
  - Returns a JSON object with the following structure:
    ```json
    {
      "status": "ok",
      "service": "_s3_storage",
      "static_root": "<resolved_static_root_path>"
    }
    ```

### Static Files Endpoint

- **Endpoint**: `GET /static/{filename}`
- **Description**: Serves static files from the specified static root directory. The filename is provided as a path parameter.

## Execution Flow

The `create_app` function is the entry point for the application. It is called when the module is executed, and it sets up the FastAPI application. The following diagram illustrates the flow of execution:

```mermaid
graph TD;
    A[main.py] -->|calls| B[create_app]
    B --> C[FastAPI Instance]
    C -->|mounts| D[/static]
    C -->|defines| E[/health]
```

## Integration with the Codebase

The S3 Storage module is designed to be integrated with other parts of the codebase, particularly for testing purposes. It is invoked in various test cases to provide a mock S3 environment. The following tests reference the `create_app` function:

- `test_annotation_can_be_saved_and_read_back`
- `test_seeded_project_artifacts_and_issues_are_queryable`
- `test_static_source_ifc_is_served`
- `test_conversion_result_is_stored_and_reloaded`

These tests ensure that the application behaves as expected when interacting with static files and the health check endpoint.

## Conclusion

The S3 Storage module is a simple yet effective tool for simulating S3 storage in a local environment. By providing static file serving and a health check endpoint, it enables developers to test their applications without relying on external services. This module is essential for maintaining a robust development and testing workflow.
