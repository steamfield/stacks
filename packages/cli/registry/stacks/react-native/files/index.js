/**
 * The bundle's entry point: registers the root component under the name the native side starts
 * (app.json's "name", which the generated AppDelegate and MainActivity also use).
 */
import { AppRegistry } from "react-native";
import { name as appName } from "./app.json";
import { App } from "./src/app/app";

AppRegistry.registerComponent(appName, () => App);
