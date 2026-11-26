/**
 * Every route in the root stack and its params. Screens type their props from this list, so a
 * renamed route or a changed param fails typecheck at each navigate call.
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Home: undefined;
  AppInfo: undefined;
};

export type RootScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Name
>;
