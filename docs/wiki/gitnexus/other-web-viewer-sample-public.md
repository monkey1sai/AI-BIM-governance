# Other — web-viewer-sample-public

# web-viewer-sample-public Module Documentation

## Overview

The **web-viewer-sample-public** module serves as a public API for accessing BIM (Building Information Modeling) assets. It provides a structured way to retrieve information about various BIM projects and their associated models. This module is primarily designed for integration with web applications that require access to BIM data for visualization or analysis.

## Purpose

The main purpose of this module is to expose a list of BIM assets, including their names and URLs, which can be used by front-end applications to load and display 3D models. This allows developers to easily integrate BIM visualization capabilities into their web applications.

## Key Components

### Asset List

The module contains a static list of BIM assets, each represented as a JSON object with the following properties:

- **name**: A descriptive name for the BIM project or model.
- **url**: The file path or URL where the BIM model can be accessed.

#### Example Asset Structure

```json
{
  "name": "BIM Conversion Smoke: project_demo_001 / version_demo_001",
  "url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc"
}
```

### Asset Data

The asset data is structured as an array of objects, each containing the name and URL of a BIM model. Below is a sample of the asset data provided by the module:

```json
[
  {
    "name": "BIM Conversion Smoke: project_demo_001 / version_demo_001",
    "url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc"
  },
  {
    "name": "BIM: 許良宇圖書館建築 2026",
    "url": "C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/許良宇圖書館建築_2026.usdc"
  }
]
```

## How It Works

The module does not perform any dynamic data fetching or processing. Instead, it serves a static list of BIM assets that can be accessed directly by clients. This design choice simplifies the integration process, as developers can rely on a consistent set of data without needing to handle complex API calls or data transformations.

### Integration with Front-End Applications

Front-end applications can consume the asset data by making a request to the module's endpoint. The response will be a JSON array containing the available BIM models, which can then be used to populate a user interface for model selection and visualization.

## Example Usage

To access the BIM asset data, a front-end application can make a simple HTTP GET request to the module's endpoint. Here’s an example using JavaScript with the Fetch API:

```javascript
fetch('http://localhost:8002/api/assets')
  .then(response => response.json())
  .then(data => {
    console.log(data); // Process the BIM asset data
  })
  .catch(error => console.error('Error fetching BIM assets:', error));
```

## Conclusion

The **web-viewer-sample-public** module provides a straightforward API for accessing BIM assets, making it easy for developers to integrate BIM visualization into their applications. By serving a static list of models, it ensures consistency and simplicity in data handling. This module is a foundational component for any web application that aims to leverage BIM data for enhanced user experiences.
