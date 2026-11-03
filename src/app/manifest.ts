import type { MetadataRoute } from "next";

/**
 * Installable. The offline story — SOS, mission and report queues, bundled
 * shelters — is the best part of this product, and a browser tab hides it.
 * An installed icon on a volunteer's home screen is the difference between
 * "that website" and "the app we use".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BhimShila — disaster intelligence for India",
    short_name: "BhimShila",
    description:
      "Live official alerts ranked by the people under them, citizen SOS, and NGO coordination.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e16",
    theme_color: "#0a0e16",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
