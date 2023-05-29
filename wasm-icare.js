/**
 * @module wasm-icare
 */

/**
 * Version of the iCARE Python package to load from PyPI.
 * @type {string}
 */
let pyICareVersion = '1.0.0';

/**
 * URL to the Pyodide CDN
 * @type {string}
 */
let pyodideCDNURL = 'https://cdn.jsdelivr.net/pyodide/v0.23.2/full/pyodide.js';

/**
 * Global variable to hold the instance of Pyodide
 * @type {object}
 */
let pyodide = null;

/**
 * Function to load Pyodide from the CDN.
 * @async
 * @function
 * @returns {Promise<void>}
 */
async function loadPyodideFromCDN() {
    if (!pyodide) {
        const script = document.createElement('script');
        script.src = pyodideCDNURL;
        document.body.appendChild(script);

        await new Promise((resolve) => {
            script.onload = resolve;
        });

        pyodide = await window.loadPyodide();
    }
}

/**
 * Function to load files from a list of URLs and write them to the Pyodide file system.
 * @param fileURLs
 * @returns {Promise<Awaited<unknown>[]>}
 */
async function fetchFilesAndWriteToPyodideFS(fileURLs) {
    if (!pyodide) {
        throw new Error('Pyodide is not loaded. Please initialize this library using the loadWasmICare() function.');
    }

    async function fetchAndWriteFile(url) {
        try {
            const response = await fetch(url);

            if (!response.ok) {
                console.error(`Failed to fetch file from ${url}`);
                return {isError: true, message: `Failed to fetch file from ${url}`};
            }

            const fileContent = await response.text();
            const fileName = url.substring(url.lastIndexOf('/') + 1);
            pyodide.FS.writeFile(fileName, fileContent);

            console.log(`File ${fileName} successfully loaded to the Pyodide file system.`);
            return {isError: false, message: `File ${fileName} successfully loaded to the Pyodide file system.`};
        } catch (error) {
            console.error(`Error fetching and writing file: ${error.message}`);
            return {isError: true, message: `Error fetching and writing file: ${error.message}`};
        }
    }

    return await Promise.all(fileURLs.map(fetchAndWriteFile));
}

/**
 * Function to load the iCARE Python package and convert it into Wasm. Return the Wasm-iCARE object.
 * @returns {Promise<*>}
 */
async function loadICare() {
    if (!pyodide) {
        throw new Error('Pyodide is not loaded. Please initialize this library using the initialize() function.');
    }

    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');
    await micropip.install('pyicare=='.concat(pyICareVersion));

    return pyodide.runPython(`import icare
icare`);
}

/**
 * Wrapper class to hold the iCARE Wasm object and add web-specific functionalities to its methods.
 * @class
 * @property {object} icare - The iCARE Wasm object.
 * @property {string} __version__ - The version of the iCARE Python package.
 */
class iCARE {
    constructor(icare) {
        this.icare = icare;
        this.__version__ = icare.__version__;
    }

    getQuotedFileNameOrNone(url) {
        return url ? `'${url.substring(url.lastIndexOf('/') + 1)}'` : 'None';
    }

    valueOrNone(value) {
        return value ? value : 'None';
    }

    quotedValueOrNone(value) {
        return value ? `'${value}'` : 'None';
    }

    /**
     * Function to convert the Wasm-iCARE output to JSON.
     * @param obj
     * @returns {{}|*}
     */
    convertICareOutputToJSON(obj) {
        if (obj instanceof Map) {
            const result = {};
            obj.forEach((value, key) => {
                result[key] = this.convertICareOutputToJSON(value);
            });
            return result;
        }

        if (Array.isArray(obj)) {
            return obj.map((item) => this.convertICareOutputToJSON(item));
        }

        return obj;
    }

    /**
     * This function is used to build absolute risk models and apply them to estimate absolute risks.
     * @async
     * @function
     * @param applyAgeStart
     *  Age(s) for the start of the interval, over which, to compute the absolute risk. If a single integer is provided,
     *  all instances in the profiles ('applyCovariateProfileUrl' and/or 'applySnpProfileUrl') are assigned this start
     *  age for the interval. If a different start age needs to be assigned for each instance, provide an array of ages
     *  as integers of the same length as the number of instances in these profiles.
     * @param applyAgeIntervalLength
     *  Number of years over which to compute the absolute risk. That is to say that the age at the end of the interval
     *  is 'applyAgeStart' + 'applyAgeIntervalLength'. If a single integer is provided, all instances in the profiles
     *  ('applyCovariateProfileUrl' and/or 'applySnpProfileUrl') are assigned this interval length. If a different
     *  interval length needs to be assigned for each instance, provide an array of interval lengths as integers of the
     *  same length as the number of instances in these profiles.
     * @param modelDiseaseIncidenceRatesUrl
     *  A URL to a CSV file containing the age-specific disease incidence rates for the population of interest. The data
     *  in the file must either contain two columns, named: ['age', 'rate'], to specify the incidence rates associated
     *  with each age group; or three columns, named: ['start_age', 'end_age', 'rate'], to specify the incidence rates
     *  associated with each age interval. The age ranges must fully cover the age intervals specified using parameters
     *  'applyAgeStart' and 'applyAgeIntervalLength'.
     * @param modelCompetingIncidenceRatesUrl
     *  A URL to a CSV file containing the age-specific incidence rates for competing events in the population of
     *  interest. The data in the file must either contain two columns, named: ['age', 'rate'], to specify the incidence
     *  rates associated with each age group; or three columns, named: ['start_age', 'end_age', 'rate'], to specify the
     *  incidence rates associated with each age interval. The age ranges must fully cover the age intervals specified
     *  using parameters 'applyAgeStart' and 'applyAgeIntervalLength'.
     * @param modelCovariateFormulaUrl
     *  A URL to a text file containing a Patsy symbolic description string of the model to be fitted,
     *  e.g. Y ~ parity + family_history.
     *  Reference: https://patsy.readthedocs.io/en/latest/formulas.html#the-formula-language
     *  Please make sure that the variable name in your dataset is not from the namespace of the Python execution
     *  context, including Python standard library, numpy, pandas, patsy, and icare. For example, a variable name "C"
     *  and "Q" would conflict with Patsy built-in functions of the same name. Variable names with the R-style periods
     *  in them should be surrounded by the Patsy quote function Q(family.history). In Python, periods are used to
     *  access attributes of objects, so they are not allowed in Patsy variable names unless surrounded by Q(). Patsy
     *  language is similar to R's formula object (https://patsy.readthedocs.io/en/latest/R-comparison.html).
     * @param modelLogRelativeRiskUrl
     *  A URL to a JSON file containing the log odds ratios, of the variables in the model except the intercept term, in
     *  association with the disease. The first-level JSON keys should correspond to the variable names generated by
     *  Patsy when building the design matrix. Their values should correspond to the log odds ratios of the variable's
     *  association with the disease.
     * @param modelReferenceDatasetUrl
     *  A URL to a CSV file containing the reference dataset with risk factor distribution that is representative of
     *  the population of interest. No missing values are permitted in this dataset.
     * @param modelReferenceDatasetWeightsVariableName
     *  A string specifying the name of the variable in the dataset at 'modelReferenceDatasetUrl' that indicates the
     *  sampling weight for each instance. If set to None (default), then a uniform weight will be assigned to each
     *  instance.
     * @param modelSnpInfoUrl
     *  A URL to a CSV file containing the information about the SNPs in the model. The data should contain three
     *  columns, named: ['snp_name', 'snp_odds_ratio', 'snp_freq'] corresponding to the SNP ID, the odds ratio of the
     *  SNP in association with the disease, and the minor allele frequency, respectively.
     * @param modelFamilyHistoryVariableName
     *  A string specifying the name of the binary variable (values: {0, 1}; missing values are permitted) in the model
     *  formula ('modelCovariateFormulaUrl') that represents the family history of the disease. This needs to be
     *  specified when using the special SNP model option so that the effect of family history can be adjusted for the
     *  presence of the SNPs.
     * @param numImputations
     *  The number of imputations for handling missing SNPs.
     * @param applyCovariateProfileUrl
     *  A URL to a CSV file containing the covariate (risk factor) profiles of the individuals for whom the absolute
     *  risk is to be computed. Missing values are permitted.
     * @param applySnpProfileUrl
     *  A URL to a CSV file containing the SNP profiles (values: {0: homozygous reference alleles, 1: heterozygous,
     *  2: homozygous alternate alleles}) of the individuals for whom the absolute risk is to be computed. Missing
     *  values are permitted.
     * @param returnLinearPredictors
     *  Set true to return the calculated linear predictor values for each individual in the 'applyCovariateProfileUrl'
     *  and/or 'applySnpProfileUrl' datasets.
     * @param returnReferenceRisks
     *  Set true to return the absolute risk estimates for each individual in the 'modelReferenceDatasetUrl' dataset.
     * @param seed
     *  Fix a seed for reproducibility.
     * @returns {Promise<{}|*>}
     *  An object with the following keys—
     *      1) 'model':
     *          An object of feature names and the associated beta values that were used to compute the absolute risk
     *          estimates.
     *      2) 'profile':
     *          A records-oriented JSON of the input profile data, the specified age intervals, and the calculated
     *          absolute risk estimates. If 'returnLinearPredictors' is set to true, they are also included as an
     *          additional column.
     *      3) 'reference_risks':
     *          If 'returnReferenceRisks' is true, this key will be present in the returned object. It will contain an
     *          array of objects, one per unique combination of the specified age intervals, containing age at the start
     *          of interval ('age_interval_start'), age at the end of interval ('age_interval_end'), and a list absolute
     *          risk estimates for the individuals in the reference dataset ('population_risks').
     *      4) 'method':
     *          A string containing the name of the method used to calculate the absolute risk estimates. When this
     *          method is used, the method name is "iCARE - absolute risk".
     */
    async computeAbsoluteRisk(
        {
            applyAgeStart,
            applyAgeIntervalLength,
            modelDiseaseIncidenceRatesUrl,
            modelCompetingIncidenceRatesUrl,
            modelCovariateFormulaUrl,
            modelLogRelativeRiskUrl,
            modelReferenceDatasetUrl,
            modelReferenceDatasetWeightsVariableName,
            modelSnpInfoUrl,
            modelFamilyHistoryVariableName,
            numImputations = 5,
            applyCovariateProfileUrl,
            applySnpProfileUrl,
            returnLinearPredictors = false,
            returnReferenceRisks = false,
            seed = 1234,
        }) {
        if (!pyodide) {
            throw new Error('Pyodide is not loaded. Please initialize this library using the loadWasmICare() function.');
        }

        const fileURLs = [
            modelDiseaseIncidenceRatesUrl,
            modelCompetingIncidenceRatesUrl,
            modelCovariateFormulaUrl,
            modelLogRelativeRiskUrl,
            modelReferenceDatasetUrl,
            modelSnpInfoUrl,
            applyCovariateProfileUrl,
            applySnpProfileUrl,
        ].filter(url => url !== undefined);

        await fetchFilesAndWriteToPyodideFS(fileURLs);

        applyAgeStart = Array.isArray(applyAgeStart) ? JSON.stringify(applyAgeStart) : self.valueOrNone(applyAgeStart);
        applyAgeIntervalLength = Array.isArray(applyAgeIntervalLength) ? JSON.stringify(applyAgeIntervalLength) : self.valueOrNone(applyAgeIntervalLength);
        modelDiseaseIncidenceRatesUrl = this.getQuotedFileNameOrNone(modelDiseaseIncidenceRatesUrl);
        modelCompetingIncidenceRatesUrl = this.getQuotedFileNameOrNone(modelCompetingIncidenceRatesUrl);
        modelCovariateFormulaUrl = this.getQuotedFileNameOrNone(modelCovariateFormulaUrl);
        modelLogRelativeRiskUrl = this.getQuotedFileNameOrNone(modelLogRelativeRiskUrl);
        modelReferenceDatasetUrl = this.getQuotedFileNameOrNone(modelReferenceDatasetUrl);
        modelReferenceDatasetWeightsVariableName = self.quotedValueOrNone(modelReferenceDatasetWeightsVariableName);
        modelSnpInfoUrl = this.getQuotedFileNameOrNone(modelSnpInfoUrl);
        modelFamilyHistoryVariableName = self.quotedValueOrNone(modelFamilyHistoryVariableName);
        numImputations = self.valueOrNone(numImputations);
        applyCovariateProfileUrl = this.getQuotedFileNameOrNone(applyCovariateProfileUrl);
        applySnpProfileUrl = this.getQuotedFileNameOrNone(applySnpProfileUrl);
        returnLinearPredictors = returnLinearPredictors ? 'True' : 'False';
        returnReferenceRisks = returnReferenceRisks ? 'True' : 'False';
        seed = self.valueOrNone(seed);

        let result = pyodide.runPython(`
result = icare.compute_absolute_risk(
  apply_age_start = ${applyAgeStart},
  apply_age_interval_length = ${applyAgeIntervalLength},
  model_disease_incidence_rates_path = ${modelDiseaseIncidenceRatesUrl},
  model_competing_incidence_rates_path = ${modelCompetingIncidenceRatesUrl},
  model_covariate_formula_path = ${modelCovariateFormulaUrl},
  model_log_relative_risk_path = ${modelLogRelativeRiskUrl},
  model_reference_dataset_path = ${modelReferenceDatasetUrl},
  model_reference_dataset_weights_variable_name = ${modelReferenceDatasetWeightsVariableName},
  model_snp_info_path = ${modelSnpInfoUrl},
  model_family_history_variable_name = ${modelFamilyHistoryVariableName},
  num_imputations = ${numImputations},
  apply_covariate_profile_path = ${applyCovariateProfileUrl},
  apply_snp_profile_path = ${applySnpProfileUrl},
  return_linear_predictors = ${returnLinearPredictors},
  return_reference_risks = ${returnReferenceRisks},
  seed = ${seed}
)

result
`).toJs();

        if (result.isError) {
            throw new Error(result.message);
        }

        result = self.convertICareOutputToJSON(result);
        result['profile'] = JSON.parse(result['profile'])

        return result;
    }

    /**
     * This function is used to build an absolute risk model that incorporates different input parameters before and
     * after a given time cut-point. The model is then applied to estimate the combined absolute risks.
     * @async
     * @function
     * @param applyAgeStart
     *  Age(s) for the start of the interval, over which, to compute the absolute risk. If a single integer is provided,
     *  all instances in the profiles ('applyCovariateProfileCutpointUrl' and/or 'applySnpProfileUrl') are assigned this
     *  start age for the interval. If a different start age needs to be assigned for each instance, provide an array of
     *  ages as integers of the same length as the number of instances in these profiles. If an array is provided, the
     *  parameters 'applyAgeIntervalLength' and 'cutpoint' must also be arrays of the same length.
     * @param applyAgeIntervalLength
     *  Number of years over which to compute the absolute risk. That is to say that the age at the end of the interval
     *  is 'applyAgeStart' + 'applyAgeIntervalLength'. If a single integer is provided, all instances in the profiles
     *  ('applyCovariateProfileCutpointUrl' and/or 'applySnpProfileUrl') are assigned this interval length. If a
     *  different interval length needs to be assigned for each instance, provide an array of interval lengths as
     *  integers of the same length as the number of instances in these profiles. If an array is provided, the
     *  parameters 'applyAgeStart' and 'cutpoint' must also be arrays of the same length.
     * @param modelDiseaseIncidenceRatesUrl
     *  A URL to a CSV file containing the age-specific disease incidence rates for the population of interest. The data
     *  in the file must either contain two columns, named: ['age', 'rate'], to specify the incidence rates associated
     *  with each age group; or three columns, named: ['start_age', 'end_age', 'rate'], to specify the incidence rates
     *  associated with each age interval. The age ranges must fully cover the age intervals specified using parameters
     *  'applyAgeStart' and 'applyAgeIntervalLength'.
     * @param modelCompetingIncidenceRatesUrl
     *  A URL to a CSV file containing the age-specific incidence rates for competing events in the population of
     *  interest. The data in the file must either contain two columns, named: ['age', 'rate'], to specify the incidence
     *  rates associated with each age group; or three columns, named: ['start_age', 'end_age', 'rate'], to specify the
     *  incidence rates associated with each age interval. The age ranges must fully cover the age intervals specified
     *  using parameters 'applyAgeStart' and 'applyAgeIntervalLength'.
     * @param modelCovariateFormulaBeforeCutpointUrl
     *  A URL to a text file containing the covariate formula for the model to be fit before the cut-point. The text
     *  should contain a string description of the covariate formula using the Patsy symbolic description language.
     *  Reference: https://patsy.readthedocs.io/en/latest/formulas.html#the-formula-language
     * @param modelCovariateFormulaAfterCutpointUrl
     *  A URL to a text file containing the covariate formula for the model to be fit after the cut-point. The text
     *  should contain a string description of the covariate formula using the Patsy symbolic description language. If
     *  this value is undefined, the covariate formula before the cut-point is used.
     *  Reference: https://patsy.readthedocs.io/en/latest/formulas.html#the-formula-language
     * @param modelLogRelativeRiskBeforeCutpointUrl
     *  A URL to a JSON file containing the log odds ratios, of the variables in the model except the intercept term, in
     *  association with the disease, for the model to be fit before the cut-point. The JSON file should contain an
     *  object with the variable names as keys and the log odds ratios as values.
     * @param modelLogRelativeRiskAfterCutpointUrl
     *  A URL to a JSON file containing the log odds ratios, of the variables in the model except the intercept term,
     *  in association with the disease, for the model to be fit after the cut-point. The JSON file should contain an
     *  object with the variable names as keys and the log odds ratios as values. If this value is undefined, the
     *  log odds ratios before the cut-point are used.
     * @param modelReferenceDatasetBeforeCutpointUrl
     *  A URL to a CSV file containing the reference dataset with risk factor distribution that is representative of
     *  the population of interest before the cut-point.
     * @param modelReferenceDatasetAfterCutpointUrl
     *  A URL to a CSV file containing the reference dataset with risk factor distribution that is representative of
     *  the population of interest after the cut-point. If this value is undefined, the reference dataset before the
     *  cut-point is used.
     * @param modelReferenceDatasetWeightsVariableNameBeforeCutpoint
     *  A string specifying the name of the variable in the dataset at 'modelReferenceDatasetBeforeCutpointUrl' that
     *  contains the sampling weights for each individual.
     * @param modelReferenceDatasetWeightsVariableNameAfterCutpoint
     *  A string specifying the name of the variable in the dataset at 'modelReferenceDatasetAfterCutpointUrl' that
     *  contains the sampling weights for each individual. If this value is undefined, the weights variable name before
     *  the cut-point is used.
     * @param modelSnpInfoUrl
     *  A URL to a CSV file containing the information about the SNPs in the model. The data should contain three
     *  columns, named: ['snp_name', 'snp_odds_ratio', 'snp_freq'] corresponding to the SNP ID, the odds ratio of the
     *  SNP in association with the disease, and the minor allele frequency, respectively.
     * @param modelFamilyHistoryVariableNameBeforeCutpoint
     *  A string specifying the name of the binary variable (values: {0, 1}; missing values are permitted) in the
     *  dataset at 'modelReferenceDatasetBeforeCutpointUrl' that indicates whether the individual has a family history
     *  of the disease.
     * @param modelFamilyHistoryVariableNameAfterCutpoint
     *  A string specifying the name of the binary variable (values: {0, 1}; missing values are permitted) in the
     *  dataset at 'modelReferenceDatasetWeightsVariableNameAfterCutpoint' that indicates whether the individual has a
     *  family history of the disease. If this value is set to None, the family history variable name before the
     *  cut-point is used.
     * @param applyCovariateProfileBeforeCutpointUrl
     *  A URL to a CSV file containing the covariate (risk factor) profiles of the individuals for whom the absolute
     *  risk is to be computed before the cut-point.
     * @param applyCovariateProfileAfterCutpointUrl
     *  A URL to a CSV file containing the covariate (risk factor) profiles of the individuals for whom the absolute
     *  risk is to be computed after the cut-point. If this value is undefined, the covariate profile before the
     *  cut-point is used.
     * @param applySnpProfileUrl
     *  A URL to a CSV file containing the SNP profiles (values: {0: homozygous reference alleles, 1: heterozygous,
     *  2: homozygous alternate alleles}) of the individuals for whom the absolute risk is to be computed. Missing
     *  values are permitted.
     * @param cutpoint
     *  Integer age using which the absolute risk computation is split into before and after the cut-point. If a single
     *  integer is provided, all instances in the profiles ('applyCovariateProfileUrl' and/or 'applySnpProfileUrl') are
     *  assigned this cut-point. If a different cut-point needs to be assigned for each instance, provide an array of
     *  cut-points as integers of the same length as the number of instances in these profiles. If an array is provided,
     *  the parameters 'applyAgeStart' and 'applyAgeIntervalLength' must also be arrays of the same length.
     * @param numImputations
     *  The number of imputations for handling missing SNPs.
     * @param returnLinearPredictors
     *  Set true to return the calculated linear predictor values for each individual in the  'applyCovariateProfileUrl'
     *  and/or 'applySnpProfileUrl' datasets.
     * @param returnReferenceRisks
     *  Set true to return the absolute risk estimates for each individual in the 'modelReferenceDatasetUrl' dataset.
     * @param seed
     *  Fix a seed for reproducibility.
     * @returns {Promise<{}|*>}
     *  An object with the following keys—
     *      1) 'model':
     *          An object containing the model parameters. It contains two further keys: 'before_cutpoint' and
     *          'after_cutpoint', each of which contains the model parameters before and after the cut-point,
     *          respectively.
     *      2) 'profile':
     *          A records-oriented JSON of the input profile data, the specified age intervals, cut-points, and the
     *          calculated absolute risk estimates. If 'returnLinearPredictors' is set to true, they are also included
     *          as an additional column.
     *      3) 'reference_risks':
     *          If 'returnReferenceRisks' is True, this key will be present in the returned dictionary. It will contain
     *          two arrays of objects with keys 'before_cutpoint' and 'after_cutpoint', each of which contains the
     *          reference risks for before and after the cut-point datasets, respectively. Each of these arrays
     *          contains objects, one per unique combination of the specified age intervals, containing age at the start
     *          of interval ('age_interval_start'), age at the end of interval ('age_interval_end'), and a list absolute
     *          risk estimates for the individuals in the reference dataset ('population_risks').
     *      4) 'method':
     *          A string containing the name of the method used to calculate the absolute risk estimates. When this
     *          method is used, the method name is "iCARE - absolute risk with split intervals".
     */
    async computeAbsoluteRiskSplitInterval(
        {
            applyAgeStart,
            applyAgeIntervalLength,
            modelDiseaseIncidenceRatesUrl,
            modelCompetingIncidenceRatesUrl,
            modelCovariateFormulaBeforeCutpointUrl,
            modelCovariateFormulaAfterCutpointUrl,
            modelLogRelativeRiskBeforeCutpointUrl,
            modelLogRelativeRiskAfterCutpointUrl,
            modelReferenceDatasetBeforeCutpointUrl,
            modelReferenceDatasetAfterCutpointUrl,
            modelReferenceDatasetWeightsVariableNameBeforeCutpoint,
            modelReferenceDatasetWeightsVariableNameAfterCutpoint,
            modelSnpInfoUrl,
            modelFamilyHistoryVariableNameBeforeCutpoint,
            modelFamilyHistoryVariableNameAfterCutpoint,
            applyCovariateProfileBeforeCutpointUrl,
            applyCovariateProfileAfterCutpointUrl,
            applySnpProfileUrl,
            cutpoint,
            numImputations = 5,
            returnLinearPredictors = false,
            returnReferenceRisks = false,
            seed = 1234,
        }) {
        if (!pyodide) {
            throw new Error('Pyodide is not loaded. Please initialize this library using the loadWasmICare() function.');
        }

        const fileURLs = [
            modelDiseaseIncidenceRatesUrl,
            modelCompetingIncidenceRatesUrl,
            modelCovariateFormulaBeforeCutpointUrl,
            modelCovariateFormulaAfterCutpointUrl,
            modelLogRelativeRiskBeforeCutpointUrl,
            modelLogRelativeRiskAfterCutpointUrl,
            modelReferenceDatasetBeforeCutpointUrl,
            modelReferenceDatasetAfterCutpointUrl,
            modelSnpInfoUrl,
            applyCovariateProfileBeforeCutpointUrl,
            applyCovariateProfileAfterCutpointUrl,
            applySnpProfileUrl,
        ].filter(url => url !== undefined);

        await fetchFilesAndWriteToPyodideFS(fileURLs);

        applyAgeStart = Array.isArray(applyAgeStart) ? JSON.stringify(applyAgeStart) : self.valueOrNone(applyAgeStart);
        applyAgeIntervalLength = Array.isArray(applyAgeIntervalLength) ? JSON.stringify(applyAgeIntervalLength) : self.valueOrNone(applyAgeIntervalLength);
        modelDiseaseIncidenceRatesUrl = self.getQuotedFileNameOrNone(modelDiseaseIncidenceRatesUrl);
        modelCompetingIncidenceRatesUrl = self.getQuotedFileNameOrNone(modelCompetingIncidenceRatesUrl);
        modelCovariateFormulaBeforeCutpointUrl = self.getQuotedFileNameOrNone(modelCovariateFormulaBeforeCutpointUrl);
        modelCovariateFormulaAfterCutpointUrl = self.getQuotedFileNameOrNone(modelCovariateFormulaAfterCutpointUrl);
        modelLogRelativeRiskBeforeCutpointUrl = self.getQuotedFileNameOrNone(modelLogRelativeRiskBeforeCutpointUrl);
        modelLogRelativeRiskAfterCutpointUrl = self.getQuotedFileNameOrNone(modelLogRelativeRiskAfterCutpointUrl);
        modelReferenceDatasetBeforeCutpointUrl = self.getQuotedFileNameOrNone(modelReferenceDatasetBeforeCutpointUrl);
        modelReferenceDatasetAfterCutpointUrl = self.getQuotedFileNameOrNone(modelReferenceDatasetAfterCutpointUrl);
        modelReferenceDatasetWeightsVariableNameBeforeCutpoint = self.quotedValueOrNone(modelReferenceDatasetWeightsVariableNameBeforeCutpoint);
        modelReferenceDatasetWeightsVariableNameAfterCutpoint = self.quotedValueOrNone(modelReferenceDatasetWeightsVariableNameAfterCutpoint);
        modelSnpInfoUrl = self.getQuotedFileNameOrNone(modelSnpInfoUrl);
        modelFamilyHistoryVariableNameBeforeCutpoint = self.quotedValueOrNone(modelFamilyHistoryVariableNameBeforeCutpoint);
        modelFamilyHistoryVariableNameAfterCutpoint = self.quotedValueOrNone(modelFamilyHistoryVariableNameAfterCutpoint);
        applyCovariateProfileBeforeCutpointUrl = self.getQuotedFileNameOrNone(applyCovariateProfileBeforeCutpointUrl);
        applyCovariateProfileAfterCutpointUrl = self.getQuotedFileNameOrNone(applyCovariateProfileAfterCutpointUrl);
        applySnpProfileUrl = self.getQuotedFileNameOrNone(applySnpProfileUrl);
        cutpoint = Array.isArray(cutpoint) ? JSON.stringify(cutpoint) : self.valueOrNone(cutpoint);
        numImputations = self.valueOrNone(numImputations);
        returnLinearPredictors = self.returnLinearPredictors ? 'True' : 'False';
        returnReferenceRisks = self.returnReferenceRisks ? 'True' : 'False';
        seed = self.valueOrNone(seed);

        let result = pyodide.runPython(`
result = icare.compute_absolute_risk_split_interval(
        apply_age_start = ${applyAgeStart},
        apply_age_interval_length = ${applyAgeIntervalLength},
        model_disease_incidence_rates_path = ${modelDiseaseIncidenceRatesUrl},
        model_competing_incidence_rates_path = ${modelCompetingIncidenceRatesUrl},
        model_covariate_formula_before_cutpoint_path = ${modelCovariateFormulaBeforeCutpointUrl},
        model_covariate_formula_after_cutpoint_path = ${modelCovariateFormulaAfterCutpointUrl},
        model_log_relative_risk_before_cutpoint_path = ${modelLogRelativeRiskBeforeCutpointUrl},
        model_log_relative_risk_after_cutpoint_path = ${modelLogRelativeRiskAfterCutpointUrl},
        model_reference_dataset_before_cutpoint_path = ${modelReferenceDatasetBeforeCutpointUrl},
        model_reference_dataset_after_cutpoint_path = ${modelReferenceDatasetAfterCutpointUrl},
        model_reference_dataset_weights_variable_name_before_cutpoint = ${modelReferenceDatasetWeightsVariableNameBeforeCutpoint},
        model_reference_dataset_weights_variable_name_after_cutpoint = ${modelReferenceDatasetWeightsVariableNameAfterCutpoint},
        model_snp_info_path = ${modelSnpInfoUrl},
        model_family_history_variable_name_before_cutpoint = ${modelFamilyHistoryVariableNameBeforeCutpoint},
        model_family_history_variable_name_after_cutpoint = ${modelFamilyHistoryVariableNameAfterCutpoint},
        apply_covariate_profile_before_cutpoint_path= ${applyCovariateProfileBeforeCutpointUrl},
        apply_covariate_profile_after_cutpoint_path = ${applyCovariateProfileAfterCutpointUrl},
        apply_snp_profile_path = ${applySnpProfileUrl},
        cutpoint = ${cutpoint},
        num_imputations = ${numImputations},
        return_linear_predictors = ${returnLinearPredictors},
        return_reference_risks = ${returnReferenceRisks},
        seed = ${seed})

result
`).toJs();

        if (result.isError) {
            throw new Error(result.message);
        }

        result = self.convertICareOutputToJSON(result);
        result['profile'] = JSON.parse(result['profile']);

        return result;
    }

    async validateAbsoluteRiskModel(
        {
            studyDataUrl,
            predictedRiskInterval,
            icareModelParameters = {
                applyAgeStart: undefined,
                applyAgeIntervalLength: undefined,
                modelDiseaseIncidenceRatesUrl: undefined,
                modelCompetingIncidenceRatesUrl: undefined,
                modelCovariateFormulaUrl: undefined,
                modelLogRelativeRiskUrl: undefined,
                modelReferenceDatasetUrl: undefined,
                modelReferenceDatasetWeightsVariableName: undefined,
                modelSnpInfoUrl: undefined,
                modelFamilyHistoryVariableName: undefined,
                numImputations: 5,
                applyCovariateProfileUrl: undefined,
                applySnpProfileUrl: undefined,
                returnLinearPredictors: false,
                returnReferenceRisks: false,
                seed: 1234,
            },
            predictedRiskVariableName,
            linearPredictorVariableName,
            referenceEntryAge,
            referenceExitAge,
            referencePredictedRisks,
            referenceLinearPredictors,
            numberOfPercentiles = 10,
            linearPredictorCutoffs,
            datasetName = 'Example dataset',
            modelName = 'Example risk prediction model',
            seed = 1234,
        }) {
        const fileURLs = [
            studyDataUrl,
            icareModelParameters.modelDiseaseIncidenceRatesUrl,
            icareModelParameters.modelCompetingIncidenceRatesUrl,
            icareModelParameters.modelCovariateFormulaUrl,
            icareModelParameters.modelLogRelativeRiskUrl,
            icareModelParameters.modelReferenceDatasetUrl,
            icareModelParameters.modelSnpInfoUrl,
            icareModelParameters.applyCovariateProfileUrl,
            icareModelParameters.applySnpProfileUrl,
        ].filter(url => url !== undefined);

        await fetchFilesAndWriteToPyodideFS(fileURLs);

        const pyicareModelParameters = {
            apply_age_start: icareModelParameters.applyAgeStart,
            apply_age_interval_length: icareModelParameters.applyAgeIntervalLength,
            model_disease_incidence_rates_path: icareModelParameters.modelDiseaseIncidenceRatesUrl ? icareModelParameters.modelDiseaseIncidenceRatesUrl.substring(icareModelParameters.modelDiseaseIncidenceRatesUrl.lastIndexOf('/') + 1) : undefined,
            model_competing_incidence_rates_path: icareModelParameters.modelCompetingIncidenceRatesUrl ? icareModelParameters.modelCompetingIncidenceRatesUrl.substring(icareModelParameters.modelCompetingIncidenceRatesUrl.lastIndexOf('/') + 1) : undefined,
            model_covariate_formula_path: icareModelParameters.modelCovariateFormulaUrl ? icareModelParameters.modelCovariateFormulaUrl.substring(icareModelParameters.modelCovariateFormulaUrl.lastIndexOf('/') + 1) : undefined,
            model_log_relative_risk_path: icareModelParameters.modelLogRelativeRiskUrl ? icareModelParameters.modelLogRelativeRiskUrl.substring(icareModelParameters.modelLogRelativeRiskUrl.lastIndexOf('/') + 1) : undefined,
            model_reference_dataset_path: icareModelParameters.modelReferenceDatasetUrl ? icareModelParameters.modelReferenceDatasetUrl.substring(icareModelParameters.modelReferenceDatasetUrl.lastIndexOf('/') + 1) : undefined,
            model_reference_dataset_weights_variable_name: icareModelParameters.modelReferenceDatasetWeightsVariableName,
            model_snp_info_path: icareModelParameters.modelSnpInfoUrl ? icareModelParameters.modelSnpInfoUrl.substring(icareModelParameters.modelSnpInfoUrl.lastIndexOf('/') + 1) : undefined,
            model_family_history_variable_name: icareModelParameters.modelFamilyHistoryVariableName,
            num_imputations: icareModelParameters.numImputations,
            apply_covariate_profile_path: icareModelParameters.applyCovariateProfileUrl ? icareModelParameters.applyCovariateProfileUrl.substring(icareModelParameters.applyCovariateProfileUrl.lastIndexOf('/') + 1) : undefined,
            apply_snp_profile_path: icareModelParameters.applySnpProfileUrl ? icareModelParameters.applySnpProfileUrl.substring(icareModelParameters.applySnpProfileUrl.lastIndexOf('/') + 1) : undefined,
            return_linear_predictors: icareModelParameters.returnLinearPredictors,
            return_reference_risks: icareModelParameters.returnReferenceRisks,
            seed: icareModelParameters.seed,
        };

        let result = self.icare.validate_absolute_risk_model(
            studyDataUrl ? studyDataUrl.substring(studyDataUrl.lastIndexOf('/') + 1) : undefined,
            predictedRiskInterval,
            pyicareModelParameters,
            predictedRiskVariableName,
            linearPredictorVariableName,
            referenceEntryAge,
            referenceExitAge,
            referencePredictedRisks,
            referenceLinearPredictors,
            numberOfPercentiles,
            linearPredictorCutoffs,
            datasetName,
            modelName,
            seed
        ).toJs();

        if (result.isError) {
            throw new Error(result.message);
        }

        result = self.convertICareOutputToJSON(result);

        return result;
    }
}

/**
 * Function to initialize Wasm-iCARE.
 * @async
 * @function
 * @returns {Promise<iCARE>}
 */
async function loadWasmICare() {
    await loadPyodideFromCDN();
    const icare = await loadICare();
    return new iCARE(icare);
}

export {
    loadWasmICare,
    pyodide
};