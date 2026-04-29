# Other — bim-streaming-server-config

# bim-streaming-server-config Module Documentation

## Overview

The **bim-streaming-server-config** module is responsible for configuring the settings used by the BIM streaming server, specifically for converting IFC (Industry Foundation Classes) files into a format suitable for rendering with Hoops. This module utilizes a JSON configuration file to define various parameters that influence the conversion process, including tessellation, material usage, and instancing.

## Purpose

The primary purpose of this module is to provide a flexible and easily modifiable configuration for the IFC to Hoops conversion process. By adjusting the parameters in the configuration file, developers can optimize the rendering performance and visual fidelity of BIM models.

## Configuration File Structure

The configuration is defined in a JSON file located at `bim-streaming-server/config/ifc-hoops-converter.json`. Below is a breakdown of the key parameters available in this configuration file:

### Key Parameters

- **accurateSurfaceCurvatures**: (boolean) If true, enables accurate surface curvature calculations during conversion.
- **accurateTessellation**: (boolean) If true, uses a more precise tessellation method.
- **convertCurves**: (boolean) If true, curves in the IFC model will be converted.
- **convertMetadata**: (boolean) If true, metadata associated with the IFC model will be included in the conversion.
- **dedup**: (boolean) If true, duplicates in the model will be removed.
- **filterStyle**: (integer) Defines the style of filtering applied to the model.
- **globalXforms**: (boolean) If true, applies global transformations to the model.
- **instancingStyle**: (integer) Specifies the style of instancing used in the conversion.
- **materialType**: (integer) Defines the type of materials to be used in the rendering.
- **reportProgress**: (boolean) If true, progress of the conversion will be reported.
- **reportProgressFreq**: (integer) Frequency of progress reporting (in terms of steps).
- **tessLOD**: (integer) Level of detail for tessellation.
- **upAxis**: (integer) Specifies the up axis for the model (0 for Y, 1 for Z).
- **useMaterials**: (boolean) If true, materials will be applied to the model.
- **useNormals**: (boolean) If true, normals will be calculated and used.
- **instancing**: (boolean) If true, instancing will be utilized to optimize rendering.
- **convertHidden**: (boolean) If true, hidden elements in the model will be converted.
- **sOptimizeConfig**: (string) Path to an optimization configuration file.
- **bOptimize**: (boolean) If true, optimization will be applied during conversion.
- **iUpAxis**: (integer) Alternative specification for the up axis.
- **dMetersPerUnit**: (float) Defines the conversion factor from model units to meters.

## How It Works

The configuration file is read by the BIM streaming server during the conversion process. The parameters defined in the JSON file directly influence how the IFC model is processed and rendered. The server uses these settings to determine the level of detail, material application, and other rendering optimizations.

### Example Usage

To modify the conversion settings, a developer can edit the `ifc-hoops-converter.json` file. For instance, to enable accurate tessellation and report progress, the following changes can be made:

```json
{
  "accurateTessellation": true,
  "reportProgress": true
}
```

## Integration with the Codebase

This module does not have direct internal or outgoing calls, as it primarily serves as a configuration repository. However, it is essential for the functioning of the BIM streaming server, which will reference this configuration during the conversion of IFC files.

### Execution Flow

Since there are no detected execution flows or internal calls, the module acts as a static configuration file. The BIM streaming server will read this configuration at runtime, applying the specified settings to the conversion process.

## Conclusion

The **bim-streaming-server-config** module is a crucial component for configuring the IFC to Hoops conversion process. By understanding the parameters available in the configuration file, developers can effectively optimize the rendering of BIM models to meet specific project requirements.
