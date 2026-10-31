import { appTransport } from "@core/app-transport";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Providers } from "./app/providers";
import { createAppRouter } from "./app/router";
import "./style.css";

const element = document.getElementById("root");
if (element === null) throw new Error("Root element is missing");
const transport = appTransport();
createRoot(element).render(
  <Providers transport={transport}>
    <RouterProvider router={createAppRouter(transport.windowLabel)} />
  </Providers>,
);
