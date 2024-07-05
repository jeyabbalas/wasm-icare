# Wasm-iCARE

<p align="center">
<img src="./images/wasm-icare-logo.png" style="width: 40%;">
</p>

A WebAssembly port of the [iCARE Python package](https://github.com/jeyabbalas/py-icare). This repository contains a JavaScript ES6 library that wraps the iCARE WebAssembly module and exposes it for the browser. This library can be used to develop web applications powered by iCARE (Individualized Coherent Absolute Risk Estimation) - a tool for building, validating, and applying absolute risk models.

## Installation

The ES6 library can be imported using jsDelivr CDN:

```js
import { loadWasmICARE } from 'https://cdn.jsdelivr.net/gh/jeyabbalas/wasm-icare@1.0.0/dist/wasm-icare.js';

const icare = await loadWasmICARE();
```


## Usage

Wasm-iCARE is a library with three main methods:

1. `compute_absolute_risk()`: a method to build and apply absolute risk models. Based on the type of risk factors present in the model and what information is available, there can be three broad variations in using this method:
   1. **Special SNP-only absolute risk model**: this variation shows you how to specify a SNP-based absolute risk model without the need to provide a reference dataset to represent the risk factor distribution of the underlying population. [![Open In ObservableHQ](public/observableLogo.svg)](https://observablehq.com/@jeyabbalas/special-snp-risk-model?collection=@jeyabbalas/wasm-icare) 
   2. **Covariate-only absolute risk model**: this option shows you how to specify a risk model with any type of covariates (including classical questionnaire-based risk factors and/or SNPs) so long as a reference dataset is available to represent the distribution of all the covariates in the underlying population. [![Open In ObservableHQ](public/observableLogo.svg)](https://observablehq.com/@jeyabbalas/covariate-risk-model?collection=@jeyabbalas/wasm-icare)
   3. **Combined SNP and covariate absolute risk model**: this option shows you how to specify a risk model that contains both SNPs and other type of covariates, such that, you have the reference dataset to represent the distribution of the covariates in the underlying population but you do not have the reference dataset to represent the SNP distribution. [![Open In ObservableHQ](public/observableLogo.svg)](https://observablehq.com/@jeyabbalas/combined-risk-model?collection=@jeyabbalas/wasm-icare)
2. `compute_absolute_risk_split_interval()`: a method to build and apply absolute risk models that relaxes the proportional hazard assumption, to some extent, by allowing you to specify different model parameters that vary before and after a cut-point in time. [![Open In ObservableHQ](public/observableLogo.svg)](https://observablehq.com/@jeyabbalas/absolute-risk-over-split-intervals?collection=@jeyabbalas/wasm-icare)
3. `validate_absolute_risk_model()`: a method to validate absolute risk models on an independent cohort study data or a case-control study nested within a cohort. [![Open In ObservableHQ](public/observableLogo.svg)](https://observablehq.com/@jeyabbalas/risk-model-validation?collection=@jeyabbalas/wasm-icare)

The ObservableHQ notebooks for all the use-cases described above is listed at: https://observablehq.com/collection/@jeyabbalas/wasm-icare.

## Demonstration
iCARE-Lit is an example of a literature-based absolute risk model of breast cancer. A repository demonstrating the use of Wasm-iCARE to develop and deploy iCARE-Lit as a web application is shown here: https://github.com/jeyabbalas/icare-lit.

## License
Wasm-iCARE is open-source licensed under the MIT License.

## References
1. [Balasubramanian JB, Choudhury PP, Mukhopadhyay S, Ahearn T, Chatterjee N, García-Closas M, Almeida JS. Wasm-iCARE: a portable and privacy-preserving web module to build, validate, and apply absolute risk models. JAMIA open. 2024 Apr 8;7(2).](https://pubmed.ncbi.nlm.nih.gov/38938691/)