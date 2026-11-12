# PDF Booklet

Turn any PDF into a booklet you can print, fold and staple.

**Use it here: <https://zion-school.github.io/pdf-booklet/>**

It runs entirely in your web browser. Your PDF stays on your computer and is never uploaded.

To use it without internet, [download the files](https://github.com/zion-school/pdf-booklet/archive/refs/heads/main.zip), unzip them and open `index.html` in your browser.

## Booklet types

| Type | Sheet → booklet page | Pages per sheet | Putting it together |
|---|---|---|---|
| **Fold 2** | A4 → A5, A5 → A6, A3 → A4 | 4 | Fold the stack once and staple the spine |
| **Fold 4 · quarto** | A4 → A6, A3 → A5 | 8 | Fold the stack twice, staple, then slit the folds at the top |
| **Fold 4 · cut & stack** | A4 → A6, A3 → A5 | 8 | Cut each sheet in half, stack the halves and fold once |

Fold 2 is the usual booklet. The Fold 4 types fit 8 pages on each sheet and make smaller, pocket-sized booklets.

## How to use it

1. **Choose a PDF**, or drop one anywhere on the page. With **Auto** selected, the sheet size is picked so your pages print at their real size.
2. **Pick the booklet type** and your printer's **duplex** (two-sided) setting. You can also change the sheet size or page scale. **More options** has page selection, signatures, auto-crop, margins and guides.
3. **Check the Sheets tab.** It shows the front and back of every sheet with your own pages, exactly as they will print.
4. **Watch How to fold.** A step-by-step animation of your own sheets shows how to stack, fold, cut, staple and slit them. Use the arrows or the step list to move back and forth.
5. **Download booklet** saves the finished PDF.

## Printing

- Print **double-sided** with the same flip setting you chose in the app (long edge or short edge).
- Print at **actual size (100%)**, not "Fit to page".
- Usually the right flip is **short edge for Fold 2** and **long edge for Fold 4**. If the back pages come out upside down, switch the duplex setting in the app and download again.

## Options

- **Sheet size:** **Auto** picks the paper that fits your pages without scaling. For example, A5 pages go on A4 sheets for Fold 2. If no paper fits exactly, it uses A4 (or Letter for US page sizes) and scales the pages. You can also choose A3, A4, A5, Letter or Legal yourself. Your page size, the sheet size and the finished booklet page size are shown underneath.
- **Page scale:** **Fit** makes each page fill its space inside the margins. **100%** keeps pages at their real size. **Custom** lets you enter a percentage. If a page is bigger than its space, the edges are trimmed evenly, which is a handy way to cut away wide margins.
- **Printer duplex:** match this to your print dialog (see [Printing](#printing)).
- **Sheets per signature:** splits a long document into several smaller folded booklets that you stack together, which makes thick booklets easier to fold. 0 keeps everything in one. For quarto, use 1–2 sheets per signature, because thicker stacks are hard to fold twice.
- **Pages:** choose which pages to include, for example `1-12, 15, 20-`, `-5`, `10-1` (reversed), `odd`, `even`, or `b` to insert a blank page. Blank pages are added at the end if needed to fill the last sheet.
- **Auto-crop:** trims the empty margins around your pages, so with **Fit** the text prints bigger. Odd and even pages are trimmed separately, so text stays in the same place from page to page.
- **Margins:** outer, inner (spine), top and bottom, in millimetres on the booklet page.
- **Guides:** prints dashed fold lines, plus a solid cut line for cut & stack.

## Folding animation

The animation uses your first few sheets with your real pages on them. It plays slowly by default (**Normal** is about twice as fast), and you can pause it or go one step at a time. If reduced motion is turned on in your system settings, it won't play by itself, and steps change without moving.

## Known limitations

- **Password-protected PDFs** must be unlocked first, for example with `qpdf --decrypt in.pdf out.pdf`.
- **Comments, annotations and filled-in form fields** are not copied into the booklet. The page content is.
- **Auto-crop** may miss text in some Chinese, Japanese or Korean PDFs and trim too much. If content gets cut off, turn auto-crop off.

## License

MIT. See [LICENSE](LICENSE).
