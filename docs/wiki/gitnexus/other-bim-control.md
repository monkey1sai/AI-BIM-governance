# Other — _bim-control

# _bim-control Module Documentation

## Overview

The **_bim-control** module serves as a local fake BIM (Building Information Modeling) data authority, specifically designed to manage and provide metadata related to conversion results. This module is essential for testing and development purposes, allowing developers to simulate interactions with BIM data without requiring a live backend.

## Purpose

The primary purpose of the _bim-control module is to facilitate the storage and retrieval of conversion result metadata in a structured JSON format. This is particularly useful for applications that need to handle BIM data conversions, enabling developers to test their implementations against a controlled dataset.

## Key Components

### API Endpoints

The module exposes two primary API endpoints for interacting with conversion results:

1. **POST /api/model-versions/{model_version_id}/conversion-result**
   - **Description**: This endpoint allows clients to submit conversion result metadata for a specific model version.
   - **Request Body**: The body of the request should contain a JSON object representing the conversion result.
   - **Response**: Returns a confirmation of the stored conversion result, typically including the model version ID and a success message.

2. **GET /api/model-versions/{model_version_id}/conversion-result**
   - **Description**: This endpoint retrieves the conversion result metadata for a specified model version.
   - **Response**: Returns a JSON object containing the conversion result data associated with the provided model version ID.

### Data Storage

Conversion results are stored in the following directory structure:

```
data/conversion_results
```

Each conversion result is saved as a JSON file, with the filename typically reflecting the model version ID. This allows for easy access and management of conversion results.

## Running the Module

To run the _bim-control module, use the following command in your terminal:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

This command starts the FastAPI application using Uvicorn as the ASGI server, enabling hot reloading for development.

## Dependencies

The module relies on the following Python packages, as specified in the `requirements.txt` file:

- `fastapi==0.111.0`: The web framework used to build the API.
- `starlette==0.37.2`: A lightweight ASGI framework that FastAPI is built upon.
- `uvicorn==0.45.0`: The ASGI server used to run the FastAPI application.

## Architecture

The architecture of the _bim-control module is straightforward, focusing on handling API requests and managing conversion result data. Below is a simple representation of the module's architecture:

```mermaid
graph TD;
    A[Client] -->|POST| B[API Endpoint: /api/model-versions/{model_version_id}/conversion-result]
    A -->|GET| C[API Endpoint: /api/model-versions/{model_version_id}/conversion-result]
    B --> D[Store Conversion Result in JSON]
    C --> E[Retrieve Conversion Result from JSON]
```

## Contribution Guidelines

Developers looking to contribute to the _bim-control module should follow these guidelines:

1. **Code Structure**: Ensure that any new features or fixes adhere to the existing code structure and style.
2. **Testing**: Write unit tests for any new functionality to ensure reliability and maintainability.
3. **Documentation**: Update this documentation to reflect any changes made to the API or functionality.

## Conclusion

The _bim-control module is a vital tool for developers working with BIM data conversions, providing a simple yet effective way to manage conversion result metadata. By utilizing the provided API endpoints, developers can easily simulate and test their applications in a controlled environment.
