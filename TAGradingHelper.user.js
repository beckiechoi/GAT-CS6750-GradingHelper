// ==UserScript==
// @name         TA Grading Helper
// @namespace    http://tampermonkey.net/
// @version      2025-03-10
// @description  TA grading helper scripts
// @author       Beckie Choi
// @match        https://*.instructure.com/courses/*/gradebook/speed_grader?*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=instructure.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const QUIZ_STYLES = `
#questions.assessment_results .question .header {
    position: sticky;
    top: 0;
    display: block;
    z-index: 10;
    overflow: visible;
}
#questions.assessment_results .question_holder .question {
    width: auto;
    max-width: 860px;
}
.question:not(.text_only_question) .text .question_text {
    margin-top: 0;
    margin-bottom: 0;
}
.question:not(.text_only_question) .text > .question_text {
    position: sticky;
    top: 50px;
    background-color: rgb(243 243 243);
    display: block;
    margin-left: -21px;
    margin-right: -21px;
    margin-top: 0;
    max-width: 100vw;
    border: 1px solid #a3a3a3;
    z-index: 1000;
    padding: 5px 15px;
    box-sizing: border-box;
    font-size: 90%;
    max-height: 200px;
    overflow-y: scroll;
    line-height: 130%;
    z-index: 11;
}
.question:not(.text_only_question) .question_text p {
    margin: 6px 0;
}
.question:not(.text_only_question) .text .question_text + .answers {
    margin-top: 20px;
}
`;

    const RUBRIC_STYLES = `
.score-formatting-options-container {
    display: flex;
    align-items: center;
    justify-content: flex-end;
}

.score-formatting-options-container select {
    margin-bottom: 0;
    width: 80px;
    margin-left: 20px;
}
`;

    const scoreOptions = {
        parens: {
            label: '(-1.5)',
            regex: ['\\(', '\\)'],
        },
        semicolon: {
            label: ' -1.5:',
            regex: ['(?:^|\\s)', '\\:']
        },
        plain: {
            label: ' -1.5 ',
            regex: ['(?:^|\\s)', '(?:\\s|\.|$)']
        },
    };

    let selectedOption = localStorage.getItem("ScoreFormattingOption") || Object.keys(scoreOptions)[0];

    function executeAfterVisible(selector, fn, intervalMS=500, hardStop=60000) {
        const timeStart = Date.now();
        const interval = setInterval(() => {
            const nodeList = document.querySelectorAll(selector);
            if (nodeList.length > 0 && nodeList[0].checkVisibility()) {
                console.log(`found the node "${selector}" visible after ${(Date.now() - timeStart)} ms`);
                clearInterval(interval);
                fn(true, nodeList);
            } else if (Date.now() - timeStart >= hardStop) {
                console.log(`did not find the node "${selector}"`);
                clearInterval(interval);
                fn(false);
            }
        }, intervalMS);
    }

    function findParent(node, selector) {
        while (node.parentElement.nodeName !== 'DOCUMENT') {
            node = node.parentElement;
            if (node.matches(selector)) return node;
        }
        return null;
    }

    function createElement(nodeType, insert, prepend=false) {
        const el = document.createElement(nodeType);
        if (prepend) {
            insert.prepend(el);
        } else {
            insert.append(el);
        }
        return el;
    }

    // react-compatible input change event emitter
    function triggerInputEvent(input, value, eventObj = Event) {
        let lastValue = input.value;
        input.value = value;

        let event;
        ['input', 'change'].forEach(e => {
            event = new eventObj(e, { bubbles: true });
            event.simulated = true;

            const tracker = input._valueTracker;
            if (tracker) {
                tracker.setValue(lastValue);
            }
            input.dispatchEvent(event);
        });
    }

    function updateRubricPoints(node, { initialPoint, cellParent, name }, skipTextEval = false) {
        let points = initialPoint;

        if (!skipTextEval) {
            // extract points from text, based on deduction points in parentheses.
            // e.g.: ...some reasons why you're deducting points ... (-0.5)
            const matcher = new RegExp(scoreOptions[selectedOption].regex[0] + '(\\-\\d{0,}(?:\\.\\d*)?)' + scoreOptions[selectedOption].regex[1], 'g')
            const matches = node.value.matchAll(matcher);

            let deductions = 0;
            let count = 0;
            for (let m of matches) {
                deductions += parseFloat(m[1], 10);
                count++;
            }

            // don't update the grade if formatted dudction points were not found.
            // if initial point was 0, this will update the score regardless.
            if (initialPoint > 0 && count === 0) return;

            if (isNaN(deductions)) {
                alert('NaN points detected: ' + node.value.match(matcher).toString());
                return;
            }

            points = initialPoint + deductions;

            // round to the nearest third to avoid JS's weird float calculation
            points = Math.round(points * 1000) / 1000;
        }

        console.log(name, points);

        // update rubric score
        triggerInputEvent(cellParent?.nextElementSibling?.querySelector('input'), points);
    }

    function updateQuizPoints(quizScoreNodeList) {
        // update quiz frame's score section too if it exists
        if (quizScoreNodeList && quizScoreNodeList.length > 0) {
            const rubricScores = [...document.querySelectorAll('#rubric_holder td:last-child:not(:first-child) input')].reduce((res, input) => {
                const name = findParent(input, 'tr').querySelector('th .description').textContent;
                const val = parseFloat(input.value, 10);

                res[name] = isNaN(val) ? '' : val;
                return res;
            }, {});

            [...quizScoreNodeList].filter(el => el.checkVisibility()).forEach((node, i) => {
                const name = node.textContent.replace('Unanswered', ''); // drop "Unanswered" label

                if (!name || !rubricScores.hasOwnProperty(name)) return;
                const scoreEl = node.nextElementSibling?.querySelector('.question_input');

                // quiz iframe uses change event
                triggerInputEvent(scoreEl, rubricScores[name], window.frames.speedgrader_iframe.contentWindow.Event);
            });
        }
    }

    // wait until rubric editor is visible
    executeAfterVisible('#rubric_assessments_list_and_edit_button_holder button.toggle_full_rubric', (result, nodeList) => {
        // abort if node not found
        if (!result) return;

        // no submission
        const noSubmissionNode = document.getElementById('this_student_does_not_have_a_submission');
        if (noSubmissionNode && noSubmissionNode.checkVisibility()) {
            return;
        }

        // button click to toggle editor & widen the sidebar
        nodeList[0].click();
        document.getElementById('right_side').style.minWidth = '540px';
        document.getElementById('left_side').style.maxWidth = `calc(100vw - ${540 + 7 + 8}px)`; // 7px for the sidebar handle and 8 for other margins

        // timeout to settle things
        executeAfterVisible('[data-selenium="criterion_comments_text"]', (result, nodeList) => {
            // quiz scores are in a separate iframe.. check after delay for loading time
            setTimeout(() => {
                let quizScoreNodeList = window.frames.speedgrader_iframe?.contentDocument?.querySelectorAll('.question_name');
                if (!quizScoreNodeList || quizScoreNodeList.length === 0) {
                    return;
                }

                const iframeDoc = window.frames.speedgrader_iframe.contentDocument;
                const style = iframeDoc.createElement("style");
                style.textContent = QUIZ_STYLES;
                iframeDoc.head.appendChild(style);

                // create save and update button
                const saveAndUpdateBtn = createElement('button', document.querySelector('#rubric_holder .button-container'), true);
                saveAndUpdateBtn.textContent = 'Save And Update Quiz Score';
                saveAndUpdateBtn.classList.add('Button');
                saveAndUpdateBtn.classList.add('Button--primary');

                // make the original save button less prominent
                const saveBtn = saveAndUpdateBtn.parentElement.querySelector('.save_rubric_button');
                saveBtn.textContent += ' Rubric Only';
                saveBtn.classList.remove('Button--primary');

                // on save update button click, update quiz points and save after a little delay
                saveAndUpdateBtn.addEventListener('click', () => {
                    // need to re-query
                    quizScoreNodeList = iframeDoc.querySelectorAll('.question_name');
                    updateQuizPoints(quizScoreNodeList);

                    setTimeout(() => {
                        // need to re-query
                        const updateBtn = iframeDoc.querySelector('#update_scores button[type="submit"]');
                        updateBtn.click();
                    }, 300);

                    setTimeout(() => saveBtn.click(), 10);
                });
            }, 5000);

            // attach focusout event handler to rubric textarea inputs
            nodeList.forEach((node) => {
                const cellParent = findParent(node, 'td');
                const scoreCell = cellParent.nextElementSibling;

                const name = cellParent.previousElementSibling?.querySelector('.description')?.textContent || 'Question';
                const initialPoint = parseFloat(scoreCell.textContent.split('/')[1], 10);

                const config = {
                    cellParent,
                    initialPoint,
                    name,
                };

                // add in a 'perfect' score button
                const perfectBtn = createElement('button', scoreCell);
                perfectBtn.textContent = 'Perfect';
                perfectBtn.addEventListener('click', () => {
                    triggerInputEvent(node, `Good job on ${name}.`);
                    updateRubricPoints(node, config, true);
                });

                // add in a 'missing' 0-point button
                const missingBtn = createElement('button', scoreCell);
                missingBtn.textContent = 'Missing';
                missingBtn.addEventListener('click', () => {
                    triggerInputEvent(node, `Missing ${name}.`);
                    updateRubricPoints(node, {...config, initialPoint: 0}, true);
                });

                // update on blur
                node.addEventListener('focusout', (e) => {
                    if (!e.target.value) return;

                    updateRubricPoints(e.target, config);
                });
            });

            // score options
            const style = document.createElement('style');
            style.textContent = RUBRIC_STYLES;
            document.head.appendChild(style);

            const rubricContainer = document.getElementById('rubric_full');
            const selectContainer = createElement('div', rubricContainer, true);
            selectContainer.classList.add('score-formatting-options-container');

            const label = createElement('label', selectContainer);
            label.textContent = 'Score Formatting: ';

            const select = createElement('select', selectContainer);
            Object.keys(scoreOptions).forEach(key => {
                const optionEl = createElement('option', select);
                optionEl.textContent = scoreOptions[key].label;
                optionEl.value = key;
            });
            select.value = selectedOption; // select initial val

            select.addEventListener('change', (e) => {
                selectedOption = e.target.value;
                localStorage.setItem("ScoreFormattingOption", selectedOption);
            });
        });
    });
})();