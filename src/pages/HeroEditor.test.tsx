import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { HeroEditor } from "./AdminDashboard";
import { DEFAULT_CONTENT, type HeroContent } from "@/lib/defaults";

/**
 * The hero editor's one piece of real judgement: when a desktop background is
 * replaced, what happens to the phone's.
 *
 * The two differ. A phone photograph is a picture the admin chose, derived from
 * nothing, so it survives whatever happens on the desktop side — silently
 * deleting a URL somebody typed is the kind of thing nobody notices until the
 * phone hero is wrong. A phone *clip*, though, is usually the phone encode of
 * the desktop clip, written by the optimiser; once that clip is replaced, its
 * encode is of a video that is no longer the hero.
 */

const PHOTO = "https://i.ibb.co/abc/hero.jpg";
const OTHER_PHOTO = "https://i.ibb.co/xyz/different.jpg";
const CLIP = "https://res.cloudinary.com/asravqmm/video/upload/v1/hero_a1.mov";
const CLIP_PHONE_ENCODE =
  "https://res.cloudinary.com/asravqmm/video/upload/f_mp4,vc_h264,w_960,c_limit,q_auto:eco,ac_none/v1/hero_a1.mp4";
const OTHER_CLIP = "https://res.cloudinary.com/asravqmm/video/upload/v1/portrait_b2.mov";

const setup = (patch: Partial<HeroContent>) => {
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <HeroEditor
        data={{ ...DEFAULT_CONTENT.hero, ...patch }}
        onChange={onChange}
        onSave={() => {}}
        saving={false}
      />
    </MemoryRouter>,
  );
  return onChange;
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("hero editor — replacing a desktop background", () => {
  it("never touches the phone photograph, whatever happens to the desktop one", () => {
    const onChange = setup({ bg_image_url: PHOTO, bg_image_mobile_url: OTHER_PHOTO });
    type("Background image URL", "https://i.ibb.co/new/third.jpg");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      bg_image_url: "https://i.ibb.co/new/third.jpg",
      bg_image_mobile_url: OTHER_PHOTO,
    }));
  });

  it("drops a phone encode of the clip being replaced", () => {
    const onChange = setup({ bg_video_url: CLIP, bg_video_mobile_url: CLIP_PHONE_ENCODE });
    type("Background video URL", OTHER_CLIP);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      bg_video_url: OTHER_CLIP,
      bg_video_mobile_url: "",
    }));
  });

  it("keeps a phone clip the admin chose separately", () => {
    const onChange = setup({ bg_video_url: CLIP, bg_video_mobile_url: OTHER_CLIP });
    type("Background video URL", "https://res.cloudinary.com/asravqmm/video/upload/v1/third_c3.mov");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      bg_video_mobile_url: OTHER_CLIP,
    }));
  });
});

describe("hero editor — the phone fields", () => {
  it("writes the phone photo and clip to their own fields", () => {
    const onChange = setup({ bg_image_url: PHOTO, bg_video_url: CLIP });

    type("Phone background image URL", OTHER_PHOTO);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      bg_image_url: PHOTO,          // the desktop side is untouched
      bg_image_mobile_url: OTHER_PHOTO,
    }));

    type("Phone background video URL", OTHER_CLIP);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      bg_video_url: CLIP,
      bg_video_mobile_url: OTHER_CLIP,
    }));
  });

  it("groups the hero's controls under headings instead of one flat column", () => {
    setup({});
    for (const heading of [
      "Text & Button",
      "Background — desktop & tablet",
      "Background — phones",
      "Appearance",
      "Countdown Timer",
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });
});
