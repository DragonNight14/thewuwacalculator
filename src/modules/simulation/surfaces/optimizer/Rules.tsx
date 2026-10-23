/*
  Author: Runor Ewhro
  description: edits optimizer echo-set, main-stat, inventory, and target constraints.
*/

import { ModalHeader } from '@/shared/ui/AppModalShell'

export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="amdl orl-modal">
      <ModalHeader over="Optimizer" title={'Rules (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧'} onClose={onClose} />
      <div className="orl-modal__body">
        <div className="amdl__prose">
          <p>
            The optimizer follows a few behind-the-scenes rules that affect what you see. Keep
            these in mind so results match your expectations {'(＾▽＾)'}.
          </p>
        </div>

        <div className="amdl__grp">
          <div className="amdl__grp-name">How runs work</div>
          <div className="amdl__prose">
            <p>
              <strong>GPU vs CPU runs.</strong> GPU (<em>WebGPU</em>) is much faster and gets used when
              available. If WebGPU is missing or you stay on CPU, large searches take longer;
              {" you'll also see a reminder the first time you try to run on CPU (if you haven't already)"}
              {' (ง •̀_•́)ง'}.
            </p>
            <p>
              <strong>Progress updates during the search.</strong> <em>HALT</em> stops early but keeps the best
              results found so far. Candidate counts and time estimates change when filters change.
              {" Don't panic if the numbers jump around"} {'(≧◡≦)'}.
            </p>
          </div>
        </div>

        <div className="amdl__grp">
          <div className="amdl__grp-name">What gets searched</div>
          <div className="amdl__prose">
            <p>
              <strong>Saved Echoes only.</strong> Every build uses Echoes in Inventory that pass
              the selected filters. If none qualify, the optimizer cannot test any builds and
              shows an empty-results message {'(；・ω・)'}.
            </p>
            <p>
              <strong>Filter strength trimming.</strong> {'The "Filter Strength" slider prunes the '}
              bottom slice of your bag using the current stat weights, so a high setting can
              silently drop usable echoes and shrink the search. When optimizing for a combo,
              this trim is skipped, so every filtered echo is considered {'(•̀‿•́)b'}.
            </p>
            <p>
              <strong>Set and main-stat guards.</strong> Allowed Sets (3pc/5pc) and Main Stat
              filters hard-block echoes that {"don't"} match, so tightening them reduces both the
              permutation count and the variety of results. Great for focused builds, less great
              {' for "show me everything" runs'} {'(´･ᴗ･ `)'}.
            </p>
            <p>
              <strong>Main echo lock cost check.</strong> Locking a main echo forces it into slot
              {' one; if that makes cost > 12 with your bag, you\'ll see "no valid combos."'}
              {" That's the cost cap doing its job"} {'(๑•̀ㅂ•́)و✧'}.
            </p>
          </div>
        </div>

        <div className="amdl__grp">
          <div className="amdl__grp-name">Limits and lenses</div>
          <div className="amdl__prose">
            <p>
              <strong>Range limits apply to single-skill searches.</strong> Min/Max fields
              discard builds with values outside the chosen limits. Tight limits can exclude
              every build, even when Inventory has many Echoes. Range limits do not apply to
              rotation targets {'(･ω･)ゞ'}.
            </p>
            <p>
              <strong>Rotation targets change the results.</strong> A rotation target ranks builds
              by the default rotation’s total damage and hides the Amplify column. Rankings
              can differ from a single-skill search {' '}
              {'(✿◠‿◠)'}.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
