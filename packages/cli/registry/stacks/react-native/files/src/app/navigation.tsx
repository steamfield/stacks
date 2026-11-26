/**
 * The root native stack. A new screen gets a route in routes.ts and a Stack.Screen here.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppInfoScreen } from "../features/app-info/app-info-screen";
import { HomeScreen } from "../features/home/home-screen";
import type { RootStackParamList } from "./routes";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Home" }} />
      <Stack.Screen name="AppInfo" component={AppInfoScreen} options={{ title: "App info" }} />
    </Stack.Navigator>
  );
}
