import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import {
  BadInputResponse,
  ConflictResponse,
  UnavailableResponse,
  UnsupportedMediaTypeResponse,
} from "../errors.ts";
import { NoQuery } from "../schemas/index.ts";
import { Item, ItemList, NewItem } from "../schemas/items.ts";

export const ItemsGroup = HttpApiGroup.make("Items").add(
  HttpApiEndpoint.get("list", "/v1/items", {
    query: NoQuery,
    success: ItemList,
    error: [BadInputResponse, UnavailableResponse],
  }),
  HttpApiEndpoint.post("create", "/v1/items", {
    query: NoQuery,
    payload: NewItem,
    success: Item.pipe(HttpApiSchema.status(201)),
    error: [BadInputResponse, ConflictResponse, UnavailableResponse, UnsupportedMediaTypeResponse],
  }),
);
