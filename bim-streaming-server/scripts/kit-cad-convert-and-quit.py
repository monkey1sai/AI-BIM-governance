import argparse
import runpy
import sys
import traceback

import carb
import omni.kit.app


def main():
    parser = argparse.ArgumentParser("CAD Converter Import and Quit")
    parser.add_argument("--process-script", required=True)
    parser.add_argument("--input-path", required=True)
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--config-path", required=True)
    # convert-ifc-to-usdc.ps1 forwards the inbound trace id to this Kit subprocess
    # (cross-service-structured-log-baseline 4.2) so kit_struct_log can adopt it from
    # the process argv. Declaring it keeps argparse strict for real typos while
    # accepting the flag the caller has always sent - without this, argparse aborted
    # with "unrecognized arguments" and every host-native IFC->USDC conversion died
    # before the converter ran. It is deliberately not forwarded to the process
    # script below, whose own parser does not accept it.
    parser.add_argument("--trace-id", default=None)
    args = parser.parse_args()

    exit_code = 0
    try:
        sys.argv = [
            args.process_script,
            "--input-path",
            args.input_path,
            "--output-path",
            args.output_path,
            "--config-path",
            args.config_path,
        ]
        runpy.run_path(args.process_script, run_name="__main__")
    except SystemExit as exc:
        if exc.code not in (None, 0):
            exit_code = exc.code if isinstance(exc.code, int) else 1
            carb.log_error(f"CAD converter exited with status {exc.code}")
    except Exception:
        exit_code = 1
        carb.log_error("CAD converter wrapper failed:\n" + traceback.format_exc())
    finally:
        omni.kit.app.get_app().post_quit(exit_code)


if __name__ == "__main__":
    main()
